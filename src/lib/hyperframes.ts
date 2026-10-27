import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPythonRenderer } from "./python";
import { lineSplitter, parseRenderProgress } from "./renderprogress";
import { GSAP_FILE, type HyperframesProject } from "./hyperframesproject";
import { buildMotionHyperframes } from "./motionhyperframes";
import type { RenderConfig } from "./motiontimeline";

/**
 * Renders a training video with HyperFrames instead of scripts/training/render.py.
 * Opt in with TRAINING_RENDERER=hyperframes; anything that stops it from
 * working falls back to render.py, so a video is still produced.
 */

/** The release the composition is written for; npx fetches it on first use. */
export const HYPERFRAMES_VERSION = "0.8.181";

export type TrainingRenderer = "python" | "hyperframes";

const rendererFrom = (name: string): TrainingRenderer =>
  process.env[name]?.trim().toLowerCase() === "hyperframes" ? "hyperframes" : "python";

/** Which compositor training videos use (TRAINING_RENDERER). */
export const trainingRenderer = () => rendererFrom("TRAINING_RENDERER");
/** Which renderer motion explainers use (MOTION_RENDERER). */
export const motionRenderer = () => rendererFrom("MOTION_RENDERER");

const TIMEOUT_MS = () => {
  const n = Number(process.env.HYPERFRAMES_TIMEOUT_MIN);
  return (Number.isFinite(n) && n > 0 ? n : 120) * 60_000;
};

/** Browser workers: each is a Chrome, so leave the rest of the server some room. */
const workers = () => {
  const n = Number(process.env.HYPERFRAMES_WORKERS);
  if (Number.isInteger(n) && n >= 1) return Math.min(8, n);
  return Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4)));
};

/** Which presenter clips carry transparency. Opaque ones need render.py's key-out. */
export async function clipsHaveAlpha(clips: string[], workDir: string): Promise<Record<string, boolean>> {
  const result = path.join(workDir, "hf-alpha.json");
  const config = path.join(workDir, "hf-alpha-config.json");
  fs.rmSync(result, { force: true });
  fs.writeFileSync(config, JSON.stringify({ op: "alpha", clips, result }));
  await runPythonRenderer(["training", "hf_assist.py"], config);
  return JSON.parse(fs.readFileSync(result, "utf8")) as Record<string, boolean>;
}

/** Writes the composition and everything it refers to into a fresh project folder. */
export function stageHyperframesProject(project: HyperframesProject, dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
  const place = (from: string, to: string) => {
    try {
      fs.linkSync(from, to);
    } catch {
      fs.copyFileSync(from, to);
    }
  };
  for (const f of project.files) place(f.from, path.join(dir, f.name));
  fs.copyFileSync(path.join(process.cwd(), "scripts", "hyperframes", "gsap.min.js"), path.join(dir, GSAP_FILE));
  fs.writeFileSync(path.join(dir, "index.html"), project.html);
  fs.writeFileSync(path.join(dir, "hyperframes.json"), "{}");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id: "training", name: "Training video" }));
}

function killTree(pid: number | undefined, child: { kill: () => void }) {
  if (pid && process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
  else child.kill();
}

/**
 * Runs `hyperframes render` in the project and resolves with the MP4 it wrote.
 * `onProgress` hears how far along it is, from 0 to 1.
 */
export function runHyperframesRender(
  dir: string,
  fps: number,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const bin = process.env.HYPERFRAMES_BIN?.trim();
  const args = ["render", "-f", String(fps), "-q", "standard", "-w", String(workers()), "-o", "render.mp4"];
  const program = bin ? [bin.includes(" ") ? `"${bin}"` : bin, ...args] : ["npx", "--yes", `hyperframes@${HYPERFRAMES_VERSION}`, ...args];
  // Windows launches npx and global CLIs through .cmd shims, which only cmd.exe can run.
  const [file, fileArgs, verbatim] =
    process.platform === "win32"
      ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `"${program.join(" ")}"`], true]
      : [program[0], program.slice(1), false];

  return new Promise((resolve, reject) => {
    const child = spawn(file, fileArgs, {
      cwd: dir,
      windowsVerbatimArguments: verbatim,
      env: { ...process.env, DO_NOT_TRACK: "1" },
    });
    // Its progress lines would crowd the real error out of the tail kept for a failure.
    let log = "";
    const hear = () =>
      lineSplitter((line) => {
        const fraction = parseRenderProgress(line);
        if (fraction === null) log = (log + line + "\n").slice(-4000);
        else onProgress?.(fraction);
      });
    const out = hear();
    const err = hear();
    child.stdout.on("data", out);
    child.stderr.on("data", err);
    const timer = setTimeout(() => {
      killTree(child.pid, child);
      reject(new Error("HyperFrames took too long and was stopped."));
    }, TIMEOUT_MS());
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start HyperFrames (${bin ?? "npx"}). ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out.end();
      err.end();
      const mp4 = path.join(dir, "render.mp4");
      if (code === 0 && fs.existsSync(mp4)) return resolve(mp4);
      const tail = log
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .slice(-6)
        .join(" ")
        .slice(-500);
      reject(new Error(`HyperFrames failed (exit ${code}). ${tail}`));
    });
  });
}

/** Normalizes the render's loudness the way render.py does, copying the picture untouched. */
export async function finishHyperframesRender(
  input: string,
  output: string,
  duration: number,
  workDir: string,
): Promise<void> {
  const config = path.join(workDir, "hf-finish-config.json");
  fs.writeFileSync(config, JSON.stringify({ op: "finish", input, output, duration }));
  await runPythonRenderer(["training", "hf_assist.py"], config);
}

export type Cutout = { file: string; width: number; height: number };

/**
 * Keys out and trims every actor picture the way render.py does, writing the
 * results beside the project, and reports each one's size.
 */
export async function prepareMotionCutouts(
  srcs: string[],
  workDir: string,
): Promise<Record<string, Cutout>> {
  const result = path.join(workDir, "hf-cutouts.json");
  const config = path.join(workDir, "hf-cutouts-config.json");
  fs.mkdirSync(workDir, { recursive: true });
  fs.rmSync(result, { force: true });
  fs.writeFileSync(config, JSON.stringify({ op: "cutouts", srcs, dir: workDir, result }));
  await runPythonRenderer(["motion", "hf_assist.py"], config);
  return JSON.parse(fs.readFileSync(result, "utf8")) as Record<string, Cutout>;
}

/** Lays the narration and music (ducked, loudness-normalized) under a silent render. */
export async function muxMotionAudio(
  renderConfigPath: string,
  input: string,
  output: string,
  workDir: string,
): Promise<void> {
  const config = path.join(workDir, "hf-mux-config.json");
  fs.writeFileSync(config, JSON.stringify({ op: "mux", config: renderConfigPath, input, output }));
  await runPythonRenderer(["motion", "hf_assist.py"], config);
}

/**
 * Renders a motion explainer with HyperFrames, from the same config render.py
 * plays back, and writes the finished MP4 (with narration and music) to `out`.
 */
export async function renderMotionWithHyperframes(
  config: RenderConfig,
  configPath: string,
  out: string,
  workDir: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const srcs = config.scenes.flatMap((s) => s.layers.flatMap((l) => (l.type === "actor" ? [l.src] : [])));
  const cutouts = srcs.length ? await prepareMotionCutouts(srcs, path.join(workDir, "cutouts")) : {};
  const project = buildMotionHyperframes(config, { cutout: (src) => cutouts[src] });
  const dir = path.join(workDir, "hyperframes");
  stageHyperframesProject(project, dir);
  const silent = await runHyperframesRender(dir, project.fps, onProgress);
  await muxMotionAudio(configPath, silent, out, workDir);
}
