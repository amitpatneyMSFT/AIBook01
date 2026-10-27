/** What every HyperFrames generator produces and the runner (hyperframes.ts) consumes. */
export type HyperframesProject = {
  html: string;
  /** Files the HTML refers to: `name` is relative to the project, `from` is where it is now. */
  files: { name: string; from: string }[];
  fps: number;
  duration: number;
};

/** The animation library the runner copies into every project. */
export const GSAP_FILE = "assets/gsap.min.js";
/** HyperFrames renders at 24, 30 or 60 frames per second. */
export const HYPERFRAMES_FPS = 30;

export const num = (n: number) => Math.round(n * 1000) / 1000;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Collects the files a composition refers to, naming each once. */
export function assetBook() {
  const files: HyperframesProject["files"] = [];
  const names = new Map<string, string>();
  return {
    files,
    add(from: string, name: string): string {
      const known = names.get(from);
      if (known) return known;
      const rel = `assets/${name}`;
      names.set(from, rel);
      files.push({ name: rel, from });
      return rel;
    },
  };
}
