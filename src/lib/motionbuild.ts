import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { generateImage, MissingConfigError, type ImageOptions } from "./ai";
import { videoPath, videoWorkDir } from "./paths";
import {
  backgroundPrompt,
  heroPrompt,
  propPrompt,
  type MotionPlan,
} from "./motion";
import { compileTimeline, mp3Duration, type SceneAssets } from "./motiontimeline";
import {
  HEARTBEAT_MS,
  narrate,
  pool,
  runPythonRenderer,
  setProgress,
  touch,
  type VideoProgress,
} from "./videobuild";
import { stampWatermark } from "./watermark";
import { motionRenderer, renderMotionWithHyperframes } from "./hyperframes";
import { throttleProgress } from "./renderprogress";

type AssetJob = {
  key: string;
  prompt: string;
  options: ImageOptions;
};

type BuildOptions = {
  /** A resolved track and its gain, or null for no music. */
  music: { file: string; gain: number; name?: string } | null;
  /** The stored watermark choice; stamped after the render. */
  watermark?: unknown;
  /** Output frame size; the timeline scales every layer to it. */
  width?: number;
  height?: number;
};

/**
 * Failures that will fail every other call as well. Anything else — a refused
 * prompt, a timeout — loses one picture and the video goes on without it.
 */
function isFatal(e: unknown): boolean {
  if (e instanceof MissingConfigError) return true;
  const status = (e as { status?: number }).status;
  return status === 401 || status === 403 || status === 404;
}

/**
 * Build a motion explainer. Runs detached from the request: assets alone take
 * several minutes, so the caller records the artifact, returns, and the client
 * watches progress on the row.
 */
export async function buildMotionVideo(
  id: string,
  plan: MotionPlan,
  voice: string,
  opts: BuildOptions
): Promise<void> {
  const work = videoWorkDir(id);
  fs.mkdirSync(work, { recursive: true });

  // The renderer reports nothing for minutes. Without this the row would look
  // abandoned and get reconciled away mid-render.
  const beat = setInterval(() => touch(id), HEARTBEAT_MS);
  try {
    await runBuild(id, plan, voice, opts, work);
  } finally {
    clearInterval(beat);
  }
}

async function runBuild(
  id: string,
  plan: MotionPlan,
  voice: string,
  opts: BuildOptions,
  work: string
): Promise<void> {
  const scenes = plan.scenes;
  const style = plan.style;

  // One job per distinct picture. The hero is shared by every scene it
  // appears in, and identical prompts are only drawn once.
  const jobs = new Map<string, AssetJob>();
  const add = (prompt: string, options: ImageOptions) => {
    const key = createHash("sha1").update(prompt).digest("hex").slice(0, 16);
    if (!jobs.has(key)) jobs.set(key, { key, prompt, options });
    return key;
  };

  const sceneKeys = scenes.map((scene) => ({
    background:
      scene.beat === "cta"
        ? null
        : add(backgroundPrompt(scene, style), { size: "1536x1024", quality: "medium" }),
    actors: scene.actors.map((a) =>
      a.kind === "hero"
        ? add(heroPrompt(style), {
            size: "1024x1536",
            quality: "medium",
            background: "transparent",
          })
        : add(propPrompt(a, style), {
            size: "1024x1024",
            quality: "medium",
            background: "transparent",
          })
    ),
  }));

  const list = [...jobs.values()];
  const files = new Map<string, string>();
  let drawn = 0;
  let firstError: unknown = null;

  setProgress(id, {
    progress: { stage: "artwork", done: 0, total: list.length } satisfies VideoProgress,
  });

  // One at a time. A small image deployment's per-minute limit turns
  // concurrent calls into a race for the retry budget.
  await pool(list, 1, async (job) => {
    try {
      const { png } = await generateImage(job.prompt, job.options);
      const file = path.join(work, `asset-${job.key}.png`);
      fs.writeFileSync(file, png);
      files.set(job.key, file);
    } catch (e) {
      if (isFatal(e)) throw e;
      console.warn("[motion] asset failed, continuing without it", e);
      firstError ??= e;
    }
    drawn++;
    setProgress(id, {
      progress: { stage: "artwork", done: drawn, total: list.length } satisfies VideoProgress,
    });
  });

  if (list.length && files.size === 0) {
    throw firstError instanceof Error
      ? firstError
      : new Error("None of the scene artwork could be generated.");
  }

  setProgress(id, {
    progress: { stage: "narration", done: 0, total: scenes.length } satisfies VideoProgress,
  });

  const clips: { file: string; seconds: number }[] = new Array(scenes.length);
  let spoken = 0;
  await pool(scenes, 3, async (scene, i) => {
    const mp3 = await narrate(scene.narration, voice);
    const file = path.join(work, `narration-${String(i + 1).padStart(2, "0")}.mp3`);
    fs.writeFileSync(file, mp3);
    clips[i] = { file, seconds: mp3Duration(mp3) };
    spoken++;
    setProgress(id, {
      progress: { stage: "narration", done: spoken, total: scenes.length } satisfies VideoProgress,
    });
  });

  setProgress(id, {
    progress: { stage: "rendering", done: 0, total: 100 } satisfies VideoProgress,
  });

  const slash = (p: string) => p.replace(/\\/g, "/");
  const assets: SceneAssets[] = sceneKeys.map((k, i) => {
    const bg = k.background ? files.get(k.background) : undefined;
    return {
      background: bg ? slash(bg) : null,
      actors: k.actors.map((key) => {
        const f = files.get(key);
        return f ? slash(f) : null;
      }),
      narration: slash(clips[i]!.file),
      narrationSeconds: clips[i]!.seconds,
    };
  });

  const music = opts.music && fs.existsSync(opts.music.file) ? opts.music : null;
  // Rendered into scratch and moved into place only once complete, so a
  // failed re-render leaves the previous video intact.
  const out = path.join(work, "render.mp4");
  const config = compileTimeline(plan, assets, {
    output: slash(out),
    music: music ? slash(music.file) : null,
    musicVolume: music?.gain,
    width: opts.width,
    height: opts.height,
  });
  const configPath = path.join(work, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // Rendering reports a whole percent, which the page draws as a bar. A fresh
  // reporter per attempt starts a fallback render's bar over.
  const reporter = () => {
    setProgress(id, {
      progress: { stage: "rendering", done: 0, total: 100 } satisfies VideoProgress,
    });
    return throttleProgress((percent) =>
      setProgress(id, {
        progress: { stage: "rendering", done: percent, total: 100 } satisfies VideoProgress,
      }),
    );
  };

  let fallback: string | undefined;
  let rendered = false;
  if (motionRenderer() === "hyperframes") {
    try {
      await renderMotionWithHyperframes(config, configPath, out, work, reporter());
      rendered = fs.existsSync(out);
    } catch (e) {
      console.warn("[motion] HyperFrames render failed, using the standard renderer", e);
      fallback =
        "HyperFrames could not render this video, so the standard renderer was used.";
    }
  }
  if (!rendered) await runPythonRenderer(["motion", "render.py"], configPath, reporter());

  if (!fs.existsSync(out)) {
    throw new Error("The renderer finished but produced no file.");
  }
  try {
    fs.unlinkSync(out.replace(/\.mp4$/, "-silent.mp4"));
  } catch {
    /* already cleaned up by the renderer */
  }

  const mark = await stampWatermark(out, opts.watermark ?? null, "motion");

  const final = videoPath(id);
  fs.mkdirSync(path.dirname(final), { recursive: true });
  fs.renameSync(out, final);

  setProgress(id, {
    progress: {
      stage: "done",
      done: 1,
      total: 1,
      note: [fallback, mark.note].filter(Boolean).join(" ") || undefined,
    } satisfies VideoProgress,
    videoUrl: `/api/video/${id}?v=${Date.now()}`,
    bytes: fs.statSync(final).size,
    music: Boolean(music),
    watermarked: mark.watermarked,
    editedSinceRender: false,
  });

  // Assets and narration clips are only inputs to the render.
  try {
    fs.rmSync(work, { recursive: true, force: true });
  } catch {
    /* leaving scratch behind is not worth failing a finished video */
  }
}
