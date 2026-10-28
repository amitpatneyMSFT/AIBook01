import { NextResponse } from "next/server";
import { ok, fail } from "@/lib/http";
import { loadTraining } from "@/lib/trainingroute";
import { findPicture, pictureSession } from "@/lib/trainingpictures";
import { compositionPalette, normalizeComposition } from "@/lib/trainingvisuals";
import { keepAliveJSON } from "@/lib/keepalive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * A picture for one visual: `{ query }` searches Microsoft Learn for a real
 * screenshot, and `{ prompt }` draws an illustration when no screenshot is
 * found or no search is given. Screenshots already used in the video, or
 * listed in `exclude`, are skipped. → `{ imageId, url, credit?, source? }`, or
 * 404 when nothing fits.
 */
export async function POST(req: Request, { params }: Ctx) {
  return keepAliveJSON(() => find(req, params));
}

async function find(req: Request, params: Ctx["params"]) {
  try {
    const { id } = await params;
    const t = loadTraining(id);
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { query?: unknown; prompt?: unknown; exclude?: unknown };
    const query = text(body.query, 120);
    const prompt = text(body.prompt, 600);
    const exclude = (Array.isArray(body.exclude) ? body.exclude : [])
      .filter((u): u is string => typeof u === "string" && u.length <= 400)
      .slice(0, 200);
    if (!query && !prompt) {
      return NextResponse.json({ error: "Give a Microsoft Learn search or describe the picture first." }, { status: 400 });
    }
    const pal = compositionPalette(normalizeComposition(t.content.composition));
    const got = await findPicture({ query, prompt }, pal, pictureSession(t.content.sections, exclude));
    if (!got) {
      return NextResponse.json(
        { error: "No matching screenshot was found on Microsoft Learn. Try other words, or describe a picture to draw." },
        { status: 404 }
      );
    }
    return ok({ ...got, url: `/api/image/${got.imageId}` });
  } catch (e) {
    return fail(e);
  }
}
