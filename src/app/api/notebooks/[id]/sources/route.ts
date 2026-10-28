import { nanoid } from "nanoid";
import { after, NextResponse } from "next/server";
import { db, floatsToBlob, transaction } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { chunkText, extractFromFile, extractFromUrl, extractFromZip, isZipUpload } from "@/lib/ingest";
import { fetchYouTubeTranscript, isYouTubeUrl } from "@/lib/youtube";
import { chatText, embed, describeAuthError, embedModel } from "@/lib/ai";
import { MAX_TITLE_CHARS, MAX_UPLOAD_BYTES, mb } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Best-effort two-sentence summary, written once the response has gone. */
async function summarize(sourceId: string, text: string) {
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
    /* a missing summary is not worth reporting */
  }
}

async function ingestOne(
  notebookId: string,
  title: string,
  kind: string,
  url: string | null,
  text: string,
  warnings: string[]
) {
  if (!text.trim()) throw new Error(`No readable text found in "${title}".`);
  title = title.slice(0, MAX_TITLE_CHARS);

  const chunks = chunkText(text);

  // Embedding is the slow, fallible step, so it runs before anything is
  // written: a failure or crash here leaves no half-ingested source behind.
  let vectors: number[][] | null = null;
  // Read before the call: the model setting may change while it is in flight.
  const model = embedModel();
  try {
    vectors = await embed(chunks, model);
  } catch (e) {
    console.warn("[ingest] embeddings unavailable, keyword search only:", e);
    const detail =
      describeAuthError(e) ?? (e instanceof Error ? e.message : "embedding call failed");
    warnings.push(`Semantic search is disabled — ${detail}`);
  }

  const sourceId = nanoid(12);
  const insert = db.prepare(
    `INSERT INTO chunks (id, source_id, notebook_id, idx, text, embedding, embed_model, embed_dims)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // One transaction: one disk sync instead of one per chunk, and the source
  // never exists without its chunks.
  transaction(() => {
    db.prepare(
      `INSERT INTO sources (id, notebook_id, title, kind, url, text, chars, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sourceId, notebookId, title, kind, url, text, text.length, Date.now());
    chunks.forEach((c, i) => {
      const vec = vectors?.[i];
      insert.run(
        nanoid(12),
        sourceId,
        notebookId,
        i,
        c,
        vec ? floatsToBlob(vec) : null,
        // Stamped so retrieval can tell whether a stored vector is comparable
        // with the current model's output.
        vec ? model : null,
        vec ? vec.length : null
      );
    });
  });

  // The summary is a nicety; the source is usable without it, so it is not
  // allowed to hold up the response.
  after(() => summarize(sourceId, text));

  return { id: sourceId, title, kind, chars: text.length, chunks: chunks.length };
}

/**
 * Unpack an uploaded ZIP and add each supported file in it as its own source.
 * Files are processed one after another, so a large archive does not burst
 * the embedding provider; a file that fails is reported and the rest go on.
 */
async function ingestArchive(
  notebookId: string,
  file: File,
  added: unknown[],
  errors: string[],
  warnings: string[]
) {
  const buf = Buffer.from(await file.arrayBuffer());
  const skipped: string[] = [];
  let found = 0;
  for await (const entry of extractFromZip(buf, file.name)) {
    if ("skipped" in entry) {
      skipped.push(entry.path);
      continue;
    }
    found++;
    if ("error" in entry) {
      errors.push(`${file.name}/${entry.path}: ${entry.error}`);
      continue;
    }
    try {
      const ex = entry.extracted;
      added.push(await ingestOne(notebookId, ex.title, ex.kind, null, ex.text, warnings));
    } catch (e) {
      errors.push(`${file.name}/${entry.path}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  if (!found) {
    throw new Error(
      skipped.length
        ? `No supported files found in "${file.name}" (${skipped.length} other file${skipped.length === 1 ? "" : "s"} skipped).`
        : `"${file.name}" is empty.`
    );
  }
  if (skipped.length) {
    const shown = skipped.slice(0, 5).join(", ");
    const more = skipped.length > 5 ? ` and ${skipped.length - 5} more` : "";
    warnings.push(
      `Skipped ${skipped.length} unsupported file${skipped.length === 1 ? "" : "s"} in "${file.name}": ${shown}${more}.`
    );
  }
}
/**
 * Reuse a source from another notebook. Its text, summary and embeddings are
 * copied as they are, so nothing is re-fetched, re-embedded or re-summarized;
 * the copy is independent afterwards, and deleting either leaves the other.
 */
function copySource(sourceId: string, notebookId: string) {
  const src = db
    .prepare(
      `SELECT id, notebook_id, title, kind, url, text, chars, summary, content_hash
         FROM sources WHERE id = ?`
    )
    .get(sourceId) as unknown as
    | {
        id: string;
        notebook_id: string;
        title: string;
        kind: string;
        url: string | null;
        text: string;
        chars: number;
        summary: string | null;
        content_hash: string | null;
      }
    | undefined;
  if (!src) throw new Error("That source no longer exists.");
  if (src.notebook_id === notebookId) throw new Error(`"${src.title}" is already in this notebook.`);

  const newId = nanoid(12);
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO sources (id, notebook_id, title, kind, url, text, chars, summary, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId,
      notebookId,
      src.title,
      src.kind,
      src.url,
      src.text,
      src.chars,
      src.summary,
      src.content_hash,
      Date.now()
    );
    const chunks = db
      .prepare(
        "SELECT idx, text, embedding, embed_model, embed_dims FROM chunks WHERE source_id = ? ORDER BY idx"
      )
      .all(sourceId) as unknown as {
      idx: number;
      text: string;
      embedding: Uint8Array | null;
      embed_model: string | null;
      embed_dims: number | null;
    }[];
    const insert = db.prepare(
      `INSERT INTO chunks (id, source_id, notebook_id, idx, text, embedding, embed_model, embed_dims)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const c of chunks) {
      insert.run(nanoid(12), newId, notebookId, c.idx, c.text, c.embedding, c.embed_model, c.embed_dims);
    }
    db.exec("COMMIT");
    return { id: newId, title: src.title, kind: src.kind, chars: src.chars, chunks: chunks.length };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id: notebookId } = await params;
    const exists = db
      .prepare("SELECT id, title FROM notebooks WHERE id = ?")
      .get(notebookId) as unknown as { id: string; title: string } | undefined;
    if (!exists) return NextResponse.json({ error: "Notebook not found" }, { status: 404 });

    const added: unknown[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];
    /** Names the notebook when an archive, not its first file, was the upload. */
    let nameHint: string | undefined;
    const ctype = req.headers.get("content-type") ?? "";

    // Refused before the body is read: parsing it buffers the whole upload in
    // memory, so the size has to be known first. Multipart framing adds a
    // little, hence the small allowance.
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json(
        {
          error: `That upload is ${mb(declared)}; the limit is ${mb(MAX_UPLOAD_BYTES)} (MAX_UPLOAD_BYTES).`,
          code: "too_large",
        },
        { status: 413 }
      );
    }

    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      for (const f of files) {
        try {
          if (f.size > MAX_UPLOAD_BYTES) {
            throw new Error(`${mb(f.size)} is over the ${mb(MAX_UPLOAD_BYTES)} limit.`);
          }
          if (isZipUpload(f.name, f.type)) {
            const before = added.length;
            await ingestArchive(notebookId, f, added, errors, warnings);
            if (added.length > before) nameHint ??= f.name;
            continue;
          }
          const ex = await extractFromFile(f);
          added.push(
            await ingestOne(notebookId, ex.title, ex.kind, null, ex.text, warnings)
          );
        } catch (e) {
          errors.push(`${f.name}: ${e instanceof Error ? e.message : "failed"}`);
        }
      }
    } else {
      const body = (await req.json()) as {
        url?: string;
        text?: string;
        title?: string;
        /** Id of a source in another notebook to reuse here. */
        copyFrom?: string;
        /** Marks pasted text that came from one of the notebook's notes. */
        kind?: "note" | "pptx";
      };
      if (body.url) {
        try {
          if (isYouTubeUrl(body.url)) {
            const yt = await fetchYouTubeTranscript(body.url);
            if (yt.warning) warnings.push(yt.warning);
            added.push(
              await ingestOne(
                notebookId,
                body.title || yt.title,
                yt.kind,
                body.url,
                yt.text,
                warnings
              )
            );
          } else {
            const ex = await extractFromUrl(body.url);
            added.push(
              await ingestOne(
                notebookId,
                body.title || ex.title,
                ex.kind === "audio" || ex.kind === "video" ? ex.kind : "url",
                body.url,
                ex.text,
                warnings
              )
            );
          }
        } catch (e) {
          // No URL prefix: a URL request carries exactly one source, and the
          // client already shows which one failed.
          errors.push(e instanceof Error ? e.message : "Could not fetch that URL.");
        }
      } else if (body.copyFrom) {
        try {
          added.push(copySource(body.copyFrom, notebookId));
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "Could not copy that source.");
        }
      } else if (body.text) {
        try {
          added.push(
            await ingestOne(
              notebookId,
              body.title || "Pasted text",
              body.kind === "note" || body.kind === "pptx" ? body.kind : "text",
              null,
              body.text,
              warnings
            )
          );
        } catch (e) {
          errors.push(e instanceof Error ? e.message : "failed");
        }
      }
    }

    if (!added.length) {
      return NextResponse.json(
        { error: errors.join("; ") || "Nothing was added." },
        { status: 400 }
      );
    }

    // Auto-name the notebook from its first source.
    if (exists.title === "Untitled notebook") {
      const count = db
        .prepare("SELECT COUNT(*) AS c FROM sources WHERE notebook_id = ?")
        .get(notebookId) as unknown as { c: number };
      if (count.c === added.length) {
        const first = nameHint ?? (added[0] as { title: string }).title;
        const name = first.replace(/\.[a-z0-9]+$/i, "").slice(0, 60);
        db.prepare("UPDATE notebooks SET title = ? WHERE id = ?").run(name, notebookId);
      }
    }

    return ok({ added, errors, warnings: [...new Set(warnings)] });
  } catch (e) {
    return fail(e);
  }
}
