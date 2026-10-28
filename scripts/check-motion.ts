/**
 * Renders a short motion explainer from synthetic assets, with no model or
 * Speech calls, to check that Python, its packages and the renderer work and
 * that the timeline compiler and renderer still agree on the config format.
 *
 * Run with: npm run check:motion
 * Add --1080p to render at 1920x1080 instead of the default 1280x720.
 * Add --hyperframes to render with the HyperFrames renderer (the one
 * MOTION_RENDERER=hyperframes selects) instead of render.py. It needs Node,
 * Chrome and ffmpeg for HyperFrames, and fetches it with npx on first use.
 *
 * Writes into .data/motion-check/ and prints the MP4 path, so the result can
 * be watched as well as checked.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MOTION_RESOLUTIONS, normalizeMotionPlan } from "../src/lib/motion";
import { compileTimeline, mp3Duration } from "../src/lib/motiontimeline";
import { renderMotionWithHyperframes } from "../src/lib/hyperframes";

const useHyperframes = process.argv.includes("--hyperframes");

const py = process.env.PYTHON_BIN || "python";
const size = MOTION_RESOLUTIONS[process.argv.includes("--1080p") ? "1080p" : "720p"];
const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "motion-check");
const slash = (p: string) => p.replace(/\\/g, "/");
const at = (name: string) => slash(path.join(dir, name));

function run(args: string[]) {
  const r = spawnSync(py, args, { stdio: "inherit" });
  if (r.error) {
    console.error(`Could not start Python ("${py}"): ${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run([path.join("scripts", "motion", "fixtures.py"), dir]);

const plan = normalizeMotionPlan({
  title: "Renderer check",
  description: "Synthetic scenes exercising every layer type and transition.",
  style: { hero: "a test figure" },
  scenes: [
    {
      beat: "problem",
      headline: "FOOD GOES TO WASTE",
      subline: "A third of all food is thrown away.",
      callouts: ["Landfill", "Methane", "Cost"],
      stat: { value: "1.3B tons", label: "wasted every year" },
      background: "kitchen",
      actors: [
        { kind: "hero", placement: "left", entrance: "slide-left", idle: "float" },
        { kind: "prop", description: "a tablet", placement: "right", entrance: "pop", idle: "bob" },
      ],
      narration: "placeholder",
      transition: "wipe",
    },
    {
      beat: "how",
      headline: "HOW IT WORKS",
      subline: "Scraps go in, water comes out.",
      callouts: [],
      background: "kitchen",
      actors: [{ kind: "hero", placement: "right", entrance: "rise", idle: "bob" }],
      narration: "placeholder",
      transition: "slide",
    },
    {
      beat: "cta",
      headline: "START TODAY",
      subline: "Request a free on-site waste audit to size the right unit.",
      callouts: ["Learn more"],
      background: "",
      actors: [
        { kind: "hero", placement: "left", entrance: "pop", idle: "none" },
        { kind: "prop", description: "a clipboard", placement: "right", entrance: "pop", idle: "float" },
      ],
      narration: "placeholder",
      transition: "fade",
    },
  ],
});
if (!plan) throw new Error("The fixture plan did not normalize.");

const clip = (n: number) => {
  const file = at(`narration-${n}.mp3`);
  return { narration: file, narrationSeconds: mp3Duration(fs.readFileSync(file)) };
};

const config = compileTimeline(
  plan,
  [
    { background: at("bg.png"), actors: [at("hero.png"), at("prop.png")], ...clip(1) },
    { background: at("bg.png"), actors: [at("hero.png")], ...clip(2) },
    { background: null, actors: [at("hero.png"), at("prop.png")], narration: null, narrationSeconds: 1.5 },
  ],
  { output: at("check.mp4"), music: at("music.mp3"), width: size.width, height: size.height }
);
const configPath = path.join(dir, "config.json");
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

const started = Date.now();
const out = path.join(dir, "check.mp4");

function report() {
  if (!fs.existsSync(out) || fs.statSync(out).size < 10_000) {
    console.error("FAIL  the renderer produced no usable file");
    process.exit(1);
  }
  console.log(
    `ok    ${config.duration.toFixed(1)} s of ${config.width}x${config.height} video rendered${useHyperframes ? " with HyperFrames" : ""} in ${((Date.now() - started) / 1000).toFixed(1)} s → ${out}`
  );
}

if (useHyperframes) {
  renderMotionWithHyperframes(config, configPath, out, dir).then(report, (e) => {
    console.error(`FAIL  ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
} else {
  run([path.join("scripts", "motion", "render.py"), configPath]);
  report();
}
