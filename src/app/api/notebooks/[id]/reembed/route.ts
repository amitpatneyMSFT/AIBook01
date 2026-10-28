import { NextResponse } from "next/server";
import { db, floatsToBlob } from "@/lib/db";
import { ok, fail } from "@/lib/http";
import { embed, embedModel } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type Ctx = { params: Promise<{ id: string }> };

type Row = { id: string; text: string };

/**
 * Re-embed a notebook's chunks with the currently configured model.
 *
 * Needed when the embedding model changes: vectors from different models are
 * not comparable, so stale chunks fall back to keyword-only ranking until they
 * are regenerated.
 */
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;

    const exists = db
      .prepare("SELECT id FROM notebooks WHERE id = ?")
      .get(id) as unknown as { id: string } | undefined;
    if (!exists) {
      return NextResponse.json({ error: "Notebook not found" }, { status: 404 });
    }

    // Only chunks that are missing a vector or carry one from another model.
    const model = embedModel();
    const stale = db
      .prepare(
        `SELECT id, text FROM chunks
          WHERE notebook_id = ?
            AND (embedding IS NULL OR embed_model IS NULL OR embed_model != ?)
          ORDER BY idx`
      )
      .all(id, model) as unknown as Row[];

    if (!stale.length) {
      return ok({ reembedded: 0, model, upToDate: true });
    }

    const update = db.prepare(
      "UPDATE chunks SET embedding = ?, embed_model = ?, embed_dims = ? WHERE id = ?"
    );

    // Batched so a partial failure still commits the work already done.
    const BATCH = 64;
    let done = 0;
    for (let i = 0; i < stale.length; i += BATCH) {
      const slice = stale.slice(i, i + BATCH);
      const vectors = await embed(slice.map((r) => r.text), model);
      slice.forEach((row, j) => {
        const vec = vectors[j];
        if (!vec) return;
        update.run(floatsToBlob(vec), model, vec.length, row.id);
        done++;
      });
    }

    return ok({ reembedded: done, model, upToDate: false });
  } catch (e) {
    return fail(e);
  }
}

/** How many chunks are stale, without changing anything. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const stats = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN embedding IS NULL THEN 1 ELSE 0 END) AS missing,
           SUM(CASE WHEN embedding IS NOT NULL
                     AND (embed_model IS NULL OR embed_model != ?)
                    THEN 1 ELSE 0 END) AS stale
         FROM chunks WHERE notebook_id = ?`
      )
      .get(embedModel(), id) as unknown as {
      total: number;
      missing: number;
      stale: number;
    };

    const models = (
      db
        .prepare(
          `SELECT DISTINCT embed_model AS m, embed_dims AS d
             FROM chunks WHERE notebook_id = ? AND embedding IS NOT NULL`
        )
        .all(id) as unknown as { m: string | null; d: number | null }[]
    ).map((r) => ({ model: r.m ?? "unknown", dims: r.d ?? 0 }));

    return ok({
      currentModel: embedModel(),
      total: stats.total ?? 0,
      missing: stats.missing ?? 0,
      stale: stats.stale ?? 0,
      models,
    });
  } catch (e) {
    return fail(e);
  }
}
