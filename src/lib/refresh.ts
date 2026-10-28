import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { db, floatsToBlob, transaction } from "@/lib/db";
import { chunkText, extractFromUrl } from "@/lib/ingest";
import { fetchYouTubeTranscript, isYouTubeUrl } from "@/lib/youtube";
import { chatText, embed, embedModel } from "@/lib/ai";

/** Sources are not re-fetched more often than this. */
export const RECHECK_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Live pages are never byte-identical between fetches — whitespace moves,
 * entities re-encode, casing in generated markup shifts. Hashing the
 * normalized form keeps those from reading as edits.
 */
export function contentHash(text: string): string {
  const normal = text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normal).digest("hex");
}

export type DiffSummary = {
  addedLines: number;
  removedLines: number;
  charDelta: number;
  changedWords: number;
  changedRatio: number;
  material: boolean;
  samples: { added: string[]; removed: string[] };
};

const lines = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

const words = (t: string) => t.toLowerCase().match(/[a-z0-9'’]+/g) ?? [];

/** Multiset difference: how many entries of `b` are not accounted for in `a`. */
function unmatched<T>(a: T[], b: T[]): { added: T[]; removed: T[] } {
  const counts = new Map<T, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);

  const added: T[] = [];
  for (const x of b) {
    const n = counts.get(x) ?? 0;
    if (n > 0) counts.set(x, n - 1);
    else added.push(x);
  }
  const removed: T[] = [];
  for (const [x, n] of counts) for (let i = 0; i < n; i++) removed.push(x);
  return { added, removed };
}

/**
 * A multiset comparison rather than a true diff: an LCS over a long article is
 * quadratic and this only has to answer "what changed, roughly, and is it worth
 * interrupting someone over".
 *
 * Materiality is judged on words, not lines. Measured against fifteen live
 * pages, line comparison called eleven of them changed when none were: a
 * journal name moving across a line break registers as several additions and
 * removals while the prose is untouched. Words survive reflow.
 */
export function diffSummary(oldText: string, newText: string): DiffSummary {
  const byLine = unmatched(lines(oldText), lines(newText));
  const byWord = unmatched(words(oldText), words(newText));

  const changedWords = byWord.added.length + byWord.removed.length;
  const total = Math.max(words(oldText).length, 1);
  const changedRatio = changedWords / total;

  // Pages carry timestamps, view counts, ad slots and rotating promos.
  // Flagging those trains people to dismiss the prompt, so a change has to be
  // both big enough and a large enough share of the page to be real content.
  const material = changedWords >= 40 && changedRatio >= 0.015;

  return {
    addedLines: byLine.added.length,
    removedLines: byLine.removed.length,
    charDelta: newText.length - oldText.length,
    changedWords,
    changedRatio,
    material,
    samples: {
      // Lines, not words, because a person reads the change to judge it.
      added: byLine.added.slice(0, 4).map((l) => l.slice(0, 220)),
      removed: byLine.removed.slice(0, 4).map((l) => l.slice(0, 220)),
    },
  };
}

export type SourceRow = {
  id: string;
  notebook_id: string;
  title: string;
  kind: string;
  url: string | null;
  text: string;
  content_hash: string | null;
  checked_at: number | null;
  pending_hash: string | null;
};

/**
 * Interstitials a publisher serves instead of the page: bot checks, JavaScript
 * walls, consent gates. They fetch with a 200 and read as a complete document,
 * so nothing upstream rejects them.
 */
const BLOCK_SIGNS = [
  /checking your browser/i,
  /enable javascript(?: and cookies)? to continue/i,
  /required part of this site (?:couldn|could not|can't)/i,
  /access (?:denied|to this page has been denied)/i,
  /are you (?:a robot|human)/i,
  /verify (?:you are human|your identity)/i,
  /unusual traffic from your/i,
  /please complete the (?:security|captcha)/i,
  /ddos protection by/i,
];

export function looksBlocked(text: string): boolean {
  // Length matters: a long article discussing CAPTCHAs is not a CAPTCHA.
  return text.length < 1200 && BLOCK_SIGNS.some((re) => re.test(text));
}

/** Re-fetch one source and record any change as pending, without applying it. */
export async function checkSource(
  row: SourceRow
): Promise<{ changed: boolean; error?: string }> {
  if (!row.url) return { changed: false };
  // Linked recordings are transcribed, which is slow and billed per minute;
  // a recording at a fixed URL does not change the way a page does.
  if (row.kind === "audio" || row.kind === "video") return { changed: false };

  const noteProblem = (message: string) => {
    db.prepare("UPDATE sources SET checked_at = ?, check_error = ? WHERE id = ?").run(
      Date.now(),
      message,
      row.id
    );
    return { changed: false, error: message };
  };

  let fresh: { title: string; text: string };
  try {
    fresh = isYouTubeUrl(row.url)
      ? await fetchYouTubeTranscript(row.url)
      : await extractFromUrl(row.url);
  } catch (e) {
    return noteProblem(
      e instanceof Error ? e.message : "Could not re-fetch this source."
    );
  }

  // Offering to swap indexed content for a bot wall is the worst outcome this
  // feature can produce, and it is not hypothetical: re-checking fifteen live
  // sources turned up three publishers now serving one. Approving it would
  // destroy a working index, so it is reported as a problem, never as a change.
  const wasBlocked = looksBlocked(row.text);
  if (looksBlocked(fresh.text) && !wasBlocked) {
    return noteProblem(
      "The publisher now serves a bot check instead of the page, so the indexed copy was kept."
    );
  }

  // The same reasoning without a recognisable phrase: content that collapses
  // to a fraction of its size is far more often a gate than an edit.
  if (
    !wasBlocked &&
    row.text.length > 2000 &&
    fresh.text.length < row.text.length * 0.4
  ) {
    return noteProblem(
      `Re-fetch returned ${fresh.text.length.toLocaleString()} characters against ${row.text.length.toLocaleString()} indexed, which usually means a gate rather than an edit. The indexed copy was kept.`
    );
  }

  const next = contentHash(fresh.text);
  // The stored hash is absent for sources indexed before checking existed, so
  // the first check records a baseline rather than reporting a phantom change.
  const baseline = row.content_hash ?? contentHash(row.text);

  if (next === baseline) {
    db.prepare(
      `UPDATE sources
          SET checked_at = ?, check_error = NULL, content_hash = ?,
              pending_text = NULL, pending_hash = NULL,
              pending_title = NULL, pending_at = NULL
        WHERE id = ?`
    ).run(Date.now(), next, row.id);
    return { changed: false };
  }

  const diff = diffSummary(row.text, fresh.text);
  if (!diff.material) {
    // Record the new hash so the same trivial drift is not re-examined on
    // every check from here on.
    db.prepare(
      "UPDATE sources SET checked_at = ?, check_error = NULL, content_hash = ? WHERE id = ?"
    ).run(Date.now(), next, row.id);
    return { changed: false };
  }

  db.prepare(
    `UPDATE sources
        SET checked_at = ?, check_error = NULL, content_hash = COALESCE(content_hash, ?),
            pending_text = ?, pending_hash = ?, pending_title = ?, pending_at = ?
      WHERE id = ?`
  ).run(
    Date.now(),
    baseline,
    fresh.text,
    next,
    fresh.title || row.title,
    Date.now(),
    row.id
  );
  return { changed: true };
}

/** Replace a source's indexed text, chunks and embeddings. */
export async function reindexSource(
  sourceId: string,
  text: string,
  title: string
): Promise<{ chunks: number; warning?: string }> {
  const row = db
    .prepare("SELECT notebook_id FROM sources WHERE id = ?")
    .get(sourceId) as unknown as { notebook_id: string } | undefined;
  if (!row) throw new Error("Source not found.");

  const chunks = chunkText(text);
  const model = embedModel();
  let vectors: number[][] | null = null;
  let warning: string | undefined;
  try {
    vectors = await embed(chunks, model);
  } catch (e) {
    warning = `Re-indexed without embeddings — ${
      e instanceof Error ? e.message : "the embedding call failed"
    }`;
  }

  // Embed before destroying the old index: if the call fails hard, the source
  // is still searchable on what it had. The swap itself is one transaction, so
  // a crash midway cannot leave the source with half its chunks.
  const insert = db.prepare(
    `INSERT INTO chunks (id, source_id, notebook_id, idx, text, embedding, embed_model, embed_dims)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  transaction(() => {
    db.prepare("DELETE FROM chunks WHERE source_id = ?").run(sourceId);
    chunks.forEach((c, i) => {
      const vec = vectors?.[i];
      insert.run(
        nanoid(12),
        sourceId,
        row.notebook_id,
        i,
        c,
        vec ? floatsToBlob(vec) : null,
        vec ? model : null,
        vec ? vec.length : null
      );
    });

    db.prepare(
      `UPDATE sources
          SET text = ?, title = ?, chars = ?, content_hash = ?,
              pending_text = NULL, pending_hash = NULL,
              pending_title = NULL, pending_at = NULL, checked_at = ?
        WHERE id = ?`
    ).run(text, title, text.length, contentHash(text), Date.now(), sourceId);
  });

  try {
    const summary = await chatText(
      [
        {
          role: "system",
          content:
            "Summarize the document in 2 sentences (max 45 words). Plain text, no preamble.",
        },
        { role: "user", content: text.slice(0, 12000) },
      ],
      0.2
    );
    if (summary) {
      db.prepare("UPDATE sources SET summary = ? WHERE id = ?").run(summary, sourceId);
    }
  } catch {
    /* a stale summary is better than a failed re-index */
  }

  return { chunks: chunks.length, warning };
}
