import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { LiveUnavailableError, liveStatus, startLiveSession } from "@/lib/livepresenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether a VASA-2 live session can run here, so the panel can say what is missing. */
export async function GET() {
  return NextResponse.json(liveStatus());
}

/** Short-lived credentials for one live session. The browser streams the avatar itself. */
export async function POST() {
  try {
    return NextResponse.json(await startLiveSession(), {
      headers: { "cache-control": "no-store" },
    });
  } catch (e) {
    if (e instanceof LiveUnavailableError) {
      return NextResponse.json({ error: e.message, code: "no_config" }, { status: 400 });
    }
    return fail(e);
  }
}
