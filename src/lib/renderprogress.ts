/**
 * Render progress. The renderers say how far along they are on stderr or
 * stdout; these turn those lines into a percent the build can record, without
 * writing the database for every frame.
 *
 * - scripts/*\/render.py print `frame 250/505`
 * - HyperFrames prints `@hf-progress {"code":"capture","done":172,"total":180,"pct":68}`
 */

/** How far along a renderer's output line says it is, 0 to 1, or null if it says nothing about progress. */
export function parseRenderProgress(line: string): number | null {
  const text = line.trim();
  const frames = /^frame (\d+)\/(\d+)$/.exec(text);
  if (frames) {
    const total = Number(frames[2]);
    return total > 0 ? Math.min(1, Number(frames[1]) / total) : null;
  }
  const hf = /^@hf-progress (\{.*\})$/.exec(text);
  if (hf) {
    try {
      const pct = (JSON.parse(hf[1]) as { pct?: unknown }).pct;
      return typeof pct === "number" && Number.isFinite(pct) ? Math.min(1, Math.max(0, pct / 100)) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Feeds output chunks, which may split lines anywhere, to `onLine` one whole line at a time; `end` hands over a last line that never got its newline. */
export function lineSplitter(onLine: (line: string) => void): ((chunk: unknown) => void) & { end: () => void } {
  let rest = "";
  const feed = (chunk: unknown) => {
    rest += String(chunk);
    const lines = rest.split(/\r\n|\r|\n/);
    rest = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  };
  feed.end = () => {
    if (rest) onLine(rest);
    rest = "";
  };
  return feed;
}

/**
 * Turns fractions into whole percents that only move forward and are written
 * at most once per `minMs`. It never reports 100: the build does that when the
 * file exists, since the renderers still have sound to mix after their last frame.
 */
export function throttleProgress(
  write: (percent: number) => void,
  opts: { minMs?: number; now?: () => number } = {},
): (fraction: number) => void {
  const minMs = opts.minMs ?? 1500;
  const now = opts.now ?? Date.now;
  let last = -1;
  let at = 0;
  return (fraction) => {
    if (!Number.isFinite(fraction)) return;
    const percent = Math.max(0, Math.min(99, Math.floor(fraction * 100)));
    if (percent <= last) return;
    const t = now();
    if (last >= 0 && t - at < minMs) return;
    last = percent;
    at = t;
    write(percent);
  };
}
