import { NextResponse } from "next/server";
import { AvatarNotConfiguredError } from "@/lib/avatarbatch";
import { startTrainingRender } from "@/lib/trainingbuild";
import { keepAliveJSON } from "@/lib/keepalive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Send the saved transcript to the avatar. Returns once Azure has accepted
 * the job; the player then polls /api/artifacts/:id for progress.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return keepAliveJSON(() => submit(id));
}

async function submit(id: string) {
  try {
    await startTrainingRender(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Reported as-is rather than through the shared handler, which would
    // rewrite a Speech permission error as Azure OpenAI setup advice.
    const status = (e as { status?: number }).status;
    const message = e instanceof Error ? e.message : "Could not start the render.";
    console.error("[training] render request failed", e);
    return NextResponse.json(
      { error: message, ...(e instanceof AvatarNotConfiguredError ? { code: "no_config" } : {}) },
      {
        status:
          e instanceof AvatarNotConfiguredError
            ? 400
            : status === 401 || status === 403
              ? 403
              : status && status >= 400 && status < 500
                ? status
                : 502,
      }
    );
  }
}
