import { db, blobToFloats } from "./db";
import { embed, embedModel } from "./ai";

export type Passage = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  idx: number;
  text: string;
  score?: number;
};

type ChunkRow = {
  id: string;
  source_id: string;
  idx: number;
  text: string;
  embedding: Uint8Array | null;
  embed_model: string | null;
  embed_dims: number | null;
  title: string;
};

function rows(notebookId: string, sourceIds?: string[]): ChunkRow[] {
  // An explicit empty selection means "none", never "all": the UI shows
  // "0 of N sources", and answering from every source would contradict it.
  if (Array.isArray(sourceIds) && sourceIds.length === 0) return [];
  let sql = `SELECT c.id, c.source_id, c.idx, c.text, c.embedding,
                    c.embed_model, c.embed_dims, s.title
             FROM chunks c JOIN sources s ON s.id = c.source_id
             WHERE c.notebook_id = ?`;
  const params: string[] = [notebookId];
  if (sourceIds && sourceIds.length) {
    sql += ` AND c.source_id IN (${sourceIds.map(() => "?").join(",")})`;
    params.push(...sourceIds);
  }
  sql += " ORDER BY s.created_at, c.idx";
  return db.prepare(sql).all(...params) as unknown as ChunkRow[];
}

/**
 * Cosine similarity over two vectors of equal length.
 *
 * Callers must check dimensions first. Comparing vectors of different sizes is
 * meaningless — embeddings from different models occupy unrelated spaces — but
 * doing so silently returns a plausible number rather than an error, which
 * degrades retrieval to noise with nothing to indicate why.
 */
function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  const n = a.length;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** A stored vector is comparable only when its model is the current one. */
function sameModel(stored: string | null, current: string): boolean {
  return stored !== null && stored === current;
}

/** Words too common to say anything about relevance. */
const STOPWORDS = new Set(
  (
    "the and for are but not you all any can had her was one our out has have " +
    "what when where which who whom why how that this these those with from into " +
    "about than then them they their there here also just only very does did " +
    "will would should could been being were your yours its it's"
  ).split(" ")
);

/**
 * Query terms worth matching: Unicode letters and digits (so accented and
 * non-Latin words count), three or more characters, plus short all-caps
 * acronyms such as "AI" or "EU" that would otherwise be dropped. Acronyms of
 * three letters or more (API, SQL, GDP) already pass the length rule.
 */
export function queryTerms(query: string): string[] {
  const out = new Set<string>();
  for (const raw of query.match(/[\p{L}\p{N}]+/gu) ?? []) {
    const lower = raw.toLowerCase();
    const acronym = raw.length === 2 && raw === raw.toUpperCase() && /\p{Lu}/u.test(raw);
    if ((raw.length >= 3 && !STOPWORDS.has(lower)) || acronym) out.add(lower);
  }
  return [...out];
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scorer for one query: the share of its terms that appear in a text, each
 * matched at the start of a word so "AI" does not match "said" and "art" does
 * not match "start". Build it once per query and apply it to every chunk.
 */
export function keywordScorer(query: string): (text: string) => number {
  const patterns = queryTerms(query).map(
    (t) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(t)}`, "u")
  );
  if (!patterns.length) return () => 0;
  return (text) => {
    const lower = text.toLowerCase();
    let hits = 0;
    for (const p of patterns) if (p.test(lower)) hits++;
    return hits / patterns.length;
  };
}

export function keywordScore(text: string, query: string): number {
  return keywordScorer(query)(text);
}

/**
 * Chunks whose embedding cannot be compared with the current model's output,
 * because they were produced by a different model. Reported rather than
 * silently skipped so the cause of weaker results is visible.
 */
export type EmbeddingMismatch = {
  staleChunks: number;
  totalChunks: number;
  models: string[];
  currentModel: string;
};

export type RetrievalResult = {
  passages: Passage[];
  mismatch: EmbeddingMismatch | null;
};

/**
 * Retrieve passages and report any embedding mismatch alongside them.
 *
 * The diagnostic is returned rather than held in module state: callers read it
 * after awaiting the model, and a concurrent request for another notebook
 * would otherwise overwrite it in between, attaching one notebook's warning to
 * another's answer.
 */
export async function retrieveWithDiagnostics(
  notebookId: string,
  query: string,
  sourceIds: string[] | undefined,
  k = 12
): Promise<RetrievalResult> {
  const all = rows(notebookId, sourceIds);
  if (!all.length) return { passages: [], mismatch: null };

  // Read once: the setting can change while the query is being embedded.
  const model = embedModel();
  let qv: Float32Array | null = null;
  try {
    qv = new Float32Array((await embed([query], model))[0]);
  } catch {
    qv = null; // fall back to keyword-only ranking
  }

  const stale = new Set<string>();
  let staleCount = 0;
  const kwScore = keywordScorer(query);

  const scored = all.map((r) => {
    const ev = blobToFloats(r.embedding);
    // Different models can share a dimension but not a vector space, so the
    // stored model must match as well as the length. Anything else is counted
    // so the degradation can be surfaced instead of quietly halving quality.
    let sem = 0;
    if (qv && ev.length) {
      if (ev.length === qv.length && sameModel(r.embed_model, model)) {
        sem = cosine(qv, ev);
      } else {
        staleCount++;
        stale.add(r.embed_model ?? `${ev.length}-dim`);
      }
    }
    const kw = kwScore(r.text);
    return {
      id: r.id,
      sourceId: r.source_id,
      sourceTitle: r.title,
      idx: r.idx,
      text: r.text,
      score: sem * 0.85 + kw * 0.15,
    } satisfies Passage;
  });

  const mismatch: EmbeddingMismatch | null = staleCount
    ? {
        staleChunks: staleCount,
        totalChunks: all.length,
        models: [...stale],
        currentModel: model,
      }
    : null;

  if (mismatch) {
    console.warn(
      `[retrieve] ${staleCount}/${all.length} chunks were embedded with ` +
        `${[...stale].join(", ")} but the current model is ${model}. ` +
        `Those chunks are ranked by keyword only. Re-embed to restore semantic search.`
    );
  }

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { passages: scored.slice(0, k), mismatch };
}

export async function retrieve(
  notebookId: string,
  query: string,
  sourceIds: string[] | undefined,
  k = 12
): Promise<Passage[]> {
  return (await retrieveWithDiagnostics(notebookId, query, sourceIds, k)).passages;
}

/** Broad, evenly-spread sample of the corpus for whole-notebook generation. */
export function sampleCorpus(
  notebookId: string,
  sourceIds: string[] | undefined,
  maxChars = 60000
): Passage[] {
  const all = rows(notebookId, sourceIds);
  if (!all.length) return [];

  const bySource = new Map<string, ChunkRow[]>();
  for (const r of all) {
    if (!bySource.has(r.source_id)) bySource.set(r.source_id, []);
    bySource.get(r.source_id)!.push(r);
  }

  const { picked, truncated } = pickSample([...bySource.values()], maxChars);
  if (truncated) {
    console.warn(
      `[retrieve] ${bySource.size} sources share a ${maxChars}-character budget, so ` +
        `${truncated} are represented by a shortened opening passage only.`
    );
  }
  return picked.map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    sourceTitle: r.title,
    idx: r.idx,
    text: r.text,
  }));
}

/**
 * Chunk positions ordered so that any prefix is spread across the document:
 * the opening, then the middle, then the quarters, and so on.
 */
export function spreadOrder(n: number): number[] {
  if (n <= 0) return [];
  const order = [0];
  const seen = new Set([0]);
  let parts = 1;
  while (order.length < n) {
    parts *= 2;
    for (let k = 1; k < parts; k += 2) {
      const i = Math.floor((k * n) / parts);
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
    if (parts > n * 2) {
      for (let i = 0; i < n; i++) if (!seen.has(i)) order.push(i);
      break;
    }
  }
  return order;
}

type Sampleable = { text: string; idx: number };

/**
 * Choose chunks from each source within a character budget.
 *
 * Every source is guaranteed its opening passage — shortened if the budget
 * cannot hold a whole chunk per source — before any source gets a second one.
 * The rest of the budget is then shared round-robin, each source contributing
 * chunks spread across its length. Without that floor a notebook with more
 * sources than whole chunks fit in the budget silently dropped most of them,
 * while the output still presented itself as drawn from all of them.
 *
 * Returned in source order, then document order, so the context reads
 * coherently.
 */
export function pickSample<T extends Sampleable>(
  sources: T[][],
  maxChars: number
): { picked: T[]; truncated: number } {
  const lists = sources.filter((l) => l.length > 0);
  if (!lists.length) return { picked: [], truncated: 0 };

  const floor = Math.max(1, Math.floor(maxChars / lists.length));
  const chosen: Set<number>[] = lists.map(() => new Set<number>());
  const out: Map<string, T> = new Map();
  const key = (s: number, i: number) => `${s}:${i}`;
  let used = 0;
  let truncated = 0;

  lists.forEach((list, s) => {
    const first = list[0];
    let item = first;
    if (first.text.length > floor) {
      item = { ...first, text: shorten(first.text, floor) };
      truncated++;
    }
    out.set(key(s, 0), item);
    chosen[s].add(0);
    used += item.text.length;
  });

  const orders = lists.map((l) => spreadOrder(l.length).filter((i) => i !== 0));
  const cursor = lists.map(() => 0);
  const open = lists.map((_, s) => orders[s].length > 0);

  while (open.some(Boolean)) {
    for (let s = 0; s < lists.length; s++) {
      if (!open[s]) continue;
      const i = orders[s][cursor[s]++];
      if (cursor[s] >= orders[s].length) open[s] = false;
      const c = lists[s][i];
      if (used + c.text.length > maxChars) {
        open[s] = false;
        continue;
      }
      out.set(key(s, i), c);
      chosen[s].add(i);
      used += c.text.length;
    }
  }

  const picked: T[] = [];
  lists.forEach((list, s) => {
    for (const i of [...chosen[s]].sort((a, b) => a - b)) picked.push(out.get(key(s, i))!);
  });
  return { picked, truncated };
}

/** Cut at a word boundary where one is close, and mark the cut. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = Math.max(1, max - 1);
  const cut = text.slice(0, room);
  const space = cut.lastIndexOf(" ");
  return (space > room * 0.6 ? cut.slice(0, space) : cut) + "…";
}

export type SearchHit = Passage & { notebookId: string; notebookTitle: string };

/**
 * Search passages across every notebook (or one, when given). `text` ranks by
 * keyword overlap only, so it works with no embedding model configured;
 * `vector` blends semantic similarity in the same way chat retrieval does.
 */
export async function searchPassages(
  query: string,
  opts: { mode?: "text" | "vector"; notebookId?: string; k?: number } = {}
): Promise<{ hits: SearchHit[]; semantic: boolean }> {
  const q = query.trim();
  if (!q) return { hits: [], semantic: false };
  let sql = `SELECT c.id, c.source_id, c.notebook_id, c.idx, c.text, c.embedding,
                    c.embed_model, c.embed_dims,
                    s.title, n.title AS notebook_title
             FROM chunks c
             JOIN sources s ON s.id = c.source_id
             JOIN notebooks n ON n.id = c.notebook_id`;
  const params: string[] = [];
  if (opts.notebookId) {
    sql += " WHERE c.notebook_id = ?";
    params.push(opts.notebookId);
  }
  const all = db.prepare(sql).all(...params) as unknown as (ChunkRow & {
    notebook_id: string;
    notebook_title: string;
  })[];
  if (!all.length) return { hits: [], semantic: false };

  let qv: Float32Array | null = null;
  const model = embedModel();
  if (opts.mode === "vector") {
    try {
      qv = new Float32Array((await embed([q], model))[0]);
    } catch {
      qv = null;
    }
  }

  // Keyword mode also matches the whole phrase, so short queries that the
  // term filter drops (acronyms, names) still find something.
  const phrase = q.toLowerCase();
  const kwScore = keywordScorer(q);
  const scored = all
    .map((r) => {
      let kw = kwScore(r.text);
      if (r.text.toLowerCase().includes(phrase)) kw = Math.max(kw, 1);
      let sem: number | null = null;
      if (qv) {
        const ev = blobToFloats(r.embedding);
        if (ev.length === qv.length && sameModel(r.embed_model, model)) sem = cosine(qv, ev);
      }
      // Chunks from another model are ranked by keywords alone, as in chat.
      const score = sem !== null ? sem * 0.85 + kw * 0.15 : kw;
      return {
        id: r.id,
        sourceId: r.source_id,
        sourceTitle: r.title,
        notebookId: r.notebook_id,
        notebookTitle: r.notebook_title,
        idx: r.idx,
        text: r.text,
        score,
        semantic: sem !== null,
      };
    })
    .filter((h) => (h.score ?? 0) > (qv && h.semantic ? 0.2 : 0))
    .map((h): SearchHit => ({
      id: h.id,
      sourceId: h.sourceId,
      sourceTitle: h.sourceTitle,
      notebookId: h.notebookId,
      notebookTitle: h.notebookTitle,
      idx: h.idx,
      text: h.text,
      score: h.score,
    }));
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { hits: scored.slice(0, opts.k ?? 20), semantic: !!qv };
}

/** Render passages as a numbered context block the model can cite as [1], [2]... */
export function buildContext(passages: Passage[]): string {
  return passages
    .map(
      (p, i) =>
        `[${i + 1}] (source: "${p.sourceTitle}", part ${p.idx + 1})\n${p.text}`
    )
    .join("\n\n---\n\n");
}

export function citationList(passages: Passage[]) {
  return passages.map((p, i) => ({
    n: i + 1,
    sourceId: p.sourceId,
    sourceTitle: p.sourceTitle,
    part: p.idx + 1,
    snippet: p.text.slice(0, 320),
  }));
}
