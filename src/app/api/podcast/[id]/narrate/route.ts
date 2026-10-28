import fs from "node:fs";
import { NextResponse } from "next/server";
import { ok, fail } from "@/lib/http";
import { keepAliveJSON } from "@/lib/keepalive";
import { audioDir, audioPath } from "@/lib/paths";
import { synthesizeDialogue } from "@/lib/speech";
import { mixMusicInto, resolveMusic } from "@/lib/music";
import { normalizeMusicChoice } from "@/lib/musicchoice";
import { readNarration } from "@/lib/narration";
import { podcastSettings, scriptForNarration } from "@/lib/podcastscript";
import { isNarrating, readPodcast, scriptOf, writePodcast } from "@/lib/podcaststore";
import { clampRate, resolveVoices, type SpeakerId } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Narrate the reviewed script: synthesize every turn, mix in the music bed if
 * one was chosen, and store the timed transcript the player follows along with.
 */
export async function POST(_req: Request, { params }: Ctx) {
  return keepAliveJSON(() => narrate(params));
}

async function narrate(params: Ctx["params"]) {
  const { id } = await params;
  const current = readPodcast(id);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (isNarrating(current)) {
    return NextResponse.json({ error: "This overview is already being narrated." }, { status: 409 });
  }

  const script = scriptOf(current);
  const { replacements } = readNarration(current.narration);
  const flat = scriptForNarration(script, replacements);
  if (!flat.turns.length) {
    return NextResponse.json(
      { error: "The script is empty — write something for the speakers to say." },
      { status: 400 }
    );
  }

  const previousStage = current.audioUrl ? "done" : "script";
  writePodcast(id, {
    ...current,
    script,
    stage: "narrating",
    narratingAt: Date.now(),
    note: undefined,
  });

  try {
    const speakers = current.speakers?.length
      ? current.speakers
      : (["a", "b"] as SpeakerId[]).map((sid) => ({ id: sid, voice: undefined as string | undefined }));
    const requested = Object.fromEntries(
      speakers.map((s) => [s.id, s.voice])
    ) as Partial<Record<SpeakerId, string>>;
    const settings = podcastSettings(current);
    const voices = resolveVoices(settings.preset, requested, speakers.length);
    const speed = clampRate(settings.rate);
    const breath = Number.isFinite(settings.breath)
      ? Math.min(2, Math.max(0, settings.breath!))
      : 1;

    const { audio, durationSec, offsets } = await synthesizeDialogue(
      flat.turns,
      voices,
      speed,
      6,
      breath
    );

    fs.mkdirSync(audioDir(), { recursive: true });
    const file = audioPath(id);
    fs.writeFileSync(file, audio);

    let withMusic = false;
    let note: string | undefined;
    const music = resolveMusic(normalizeMusicChoice(current.musicChoice));
    if (music) {
      try {
        await mixMusicInto(file, music, "audio");
        withMusic = true;
      } catch (e) {
        console.warn("[podcast] music mix failed, keeping the narration without it", e);
        note = "The music could not be mixed in, so the overview was saved without it.";
      }
    }

    const resolvedSpeakers = speakers.map((s) => ({ ...s, voice: voices[s.id] }));
    const fresh = readPodcast(id) ?? current;
    const content = {
      ...fresh,
      script,
      stage: "done",
      narratingAt: undefined,
      note,
      turns: flat.turns.map((t, i) => ({ ...t, at: Number(offsets[i]!.toFixed(2)) })),
      // Cache-busted so narrating again is not served from the browser's copy.
      audioUrl: `/api/audio/${id}?v=${Date.now()}`,
      durationSec: Number(durationSec.toFixed(2)),
      voices: {
        a: voices.a,
        b: voices.b,
        ...Object.fromEntries(resolvedSpeakers.map((s) => [s.id, s.voice])),
      },
      speakers: resolvedSpeakers,
      rate: speed,
      music: withMusic,
      chapters: flat.marks.map((m) => ({
        title: m.title,
        at: Number((offsets[m.index] ?? 0).toFixed(2)),
      })),
      editedSinceNarration: false,
      settings: { ...settings, rate: speed, breath },
    };
    writePodcast(id, content);
    return ok({ id, type: "podcast", title: content.title, content });
  } catch (e) {
    const fresh = readPodcast(id) ?? current;
    writePodcast(id, {
      ...fresh,
      stage: previousStage,
      narratingAt: undefined,
      note: e instanceof Error ? e.message : "Narration failed.",
    });
    return fail(e);
  }
}
