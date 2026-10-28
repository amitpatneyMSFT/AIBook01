import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPythonRenderer } from "./python";
import { GSAP_FILE, type HyperframesProject } from "./traininghyperframes";

/**
 * Renders a training video with HyperFrames instead of scripts/training/render.py.
 * Opt in with TRAINING_RENDERER=hyperframes; anything that stops it from
 * working falls back to render.py, so a video is still produced.
 */

/** The release the composition is written for; npx fetches it on first use. */
export const HYPERFRAMES_VERSION = "0.8.181";

export type TrainingRenderer = "python" | "hyperframes";

export function trainingRenderer(): TrainingRenderer {
  return process.env.TRAINING_RENDERER?.trim().toLowerCase() === "hyperframes" ? "hyperframes" : "python";
}

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
  fs.copyFileSync(path.join(process.cwd(), "scripts", "training", "gsap.min.js"), path.join(dir, GSAP_FILE));
  fs.writeFileSync(path.join(dir, "index.html"), project.html);
  fs.writeFileSync(path.join(dir, "hyperframes.json"), "{}");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id: "training", name: "Training video" }));
}

function killTree(pid: number | undefined, child: { kill: () => void }) {
  if (pid && process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"]);
  else child.kill();
}

/** Runs `hyperframes render` in the project and resolves with the MP4 it wrote. */
export function runHyperframesRender(dir: string, fps: number): Promise<string> {
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
    let log = "";
    const keep = (d: unknown) => (log = (log + String(d)).slice(-4000));
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
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
      const out = path.join(dir, "render.mp4");
      if (code === 0 && fs.existsSync(out)) return resolve(out);
      const tail = log
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith("@hf-progress"))
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
