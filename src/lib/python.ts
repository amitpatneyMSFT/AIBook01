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

    // Progress lines would crowd the real error out of the tail kept for a failure.
    let err = "";
    const read = lineSplitter((line) => {
      const fraction = parseRenderProgress(line);
      if (fraction === null) err += line + "\n";
      else onProgress?.(fraction);
    });
    child.stderr.on("data", read);
    child.on("error", (e) =>
      reject(
        new Error(
          `Could not start Python ("${py}"). The renderer needs Python with numpy, Pillow and imageio-ffmpeg. ${e.message}`
        )
      )
    );
    child.on("close", (code) => {
      read.end();
      if (code === 0) resolve();
      else reject(new Error(`The renderer failed (exit ${code}). ${err.slice(-400)}`));
    });
  });
}
