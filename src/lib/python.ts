import { spawn } from "node:child_process";
import path from "node:path";
import { lineSplitter, parseRenderProgress } from "./renderprogress";

/**
 * Run a renderer under scripts/ with a config file, rejecting with its stderr
 * tail. Renderers that print `frame N/total` report how far along they are to
 * `onProgress` as a fraction from 0 to 1.
 */
export function runPythonRenderer(
  scriptPath: string[],
  configPath: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "scripts", ...scriptPath);
    const py = process.env.PYTHON_BIN || "python";
    const child = spawn(py, [script, configPath], { cwd: process.cwd() });

    // A renderer that hangs would hold the build, its heartbeat and a worker
    // forever. Generous, because real renders run for many minutes.
    const limitMin = Number(process.env.PYTHON_RENDER_TIMEOUT_MIN);
    const limitMs = (Number.isFinite(limitMin) && limitMin > 0 ? limitMin : 120) * 60_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, limitMs);

    // Progress lines would crowd the real error out of the tail kept for a failure.
    let err = "";
    const read = lineSplitter((line) => {
      const fraction = parseRenderProgress(line);
      if (fraction === null) err = (err + line + "\n").slice(-4000);
      else onProgress?.(fraction);
    });
    child.stderr.on("data", read);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not start Python ("${py}"). The renderer needs Python with numpy, Pillow and imageio-ffmpeg. ${e.message}`
        )
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      read.end();
      if (timedOut) {
        reject(new Error(`The renderer was stopped after ${Math.round(limitMs / 60_000)} minutes.`));
      } else if (code === 0) resolve();
      else reject(new Error(`The renderer failed (exit ${code}). ${err.slice(-400)}`));
    });
  });
}
