/**
 * Composes a short training video from synthetic presenter clips and drawings,
 * with no Azure, model or Speech calls, to check that Python, its packages and
 * ffmpeg's VP9 alpha decoding work, and that the timeline compiler and the
 * compositor still agree on the config format.
 *
 * Run with: npm run check:training
 * Add --1080p to compose at 1920x1080 instead of the default 1280x720.
 * Add --no-animation to exercise instant cuts and simultaneous bullet reveals.
 * Add --hyperframes to compose with the HyperFrames renderer (the one
 * TRAINING_RENDERER=hyperframes selects) instead of render.py. It needs
 * Node, Chrome and ffmpeg for HyperFrames, and fetches it with npx on first use.
 *
 * Writes into .data/training-check/ and prints the MP4 path, so the result can
 * be watched as well as checked.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ANIMATION_PRESETS,
  DEFAULT_COMPOSITION,
  compositionPalette,
  normalizeAnimation,
  normalizeCues,
} from "../src/lib/trainingvisuals";
import {
  compileTrainingTimeline,
  estimateSectionTiming,
  rasterJobs,
  renderConfig,
  type ComposeInput,
} from "../src/lib/trainingtimeline";
import { buildHyperframesProject } from "../src/lib/traininghyperframes";
import {
  clipsHaveAlpha,
  finishHyperframesRender,
  runHyperframesRender,
  stageHyperframesProject,
} from "../src/lib/hyperframes";

const useHyperframes = process.argv.includes("--hyperframes");

const py = process.env.PYTHON_BIN || "python";
const dir = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "training-check");
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

const S1 = "Welcome to the check. Here is what you will learn today. First the stage, then the panels.";
const S2 = "The pilot built 24 beds. Most residents said they would join.";
const composition = {
  ...DEFAULT_COMPOSITION,
  animation: normalizeAnimation(process.argv.includes("--no-animation") ? ANIMATION_PRESETS.none : ANIMATION_PRESETS.full),
  resolution: process.argv.includes("--1080p") ? ("1080p" as const) : ("720p" as const),
  sectionCards: true,
  intro: true,
  outro: true,
  lowerThird: { enabled: true, name: "Check Presenter", role: "Renderer" },
};
const input: ComposeInput = {
  title: "Compositor check",
  description: "Synthetic sections exercising every layout and transition.",
  objectives: ["See the stage", "See the panels"],
  composition,
  sections: [
    {
      title: "Welcome",
      text: S1,
      cues: normalizeCues([
        { kind: "objectives", anchor: "Here is what you will learn", layout: "side-left", transition: "slide",
          bullets: [{ text: "Stage", anchor: "First the stage" }, { text: "Panels", anchor: "then the panels" }] },
      ]),
    },
    {
      title: "Numbers",
      text: S2,
      cues: normalizeCues([
        { kind: "stat", anchor: "The pilot built 24 beds", layout: "pip", transition: "zoom",
          stat: { value: "24", label: "beds" } },
        { kind: "quote", anchor: "Most residents said", layout: "full", transition: "wipe",
          quote: { text: "We would join." } },
      ]),
    },
  ],
};

fs.mkdirSync(dir, { recursive: true });
const jobsPath = path.join(dir, "jobs.json");
fs.writeFileSync(jobsPath, JSON.stringify(rasterJobs(input)));
run([path.join("scripts", "training", "fixtures.py"), dir, jobsPath, ...(useHyperframes ? ["--alpha"] : [])]);

// The fixture clips run 6 s and 5 s; time the speech to them as Azure's would be.
const timings = [
  { ...estimateSectionTiming(S1), duration: 6, source: "avatar" as const },
  { ...estimateSectionTiming(S2), duration: 5, source: "avatar" as const },
];
const tl = compileTrainingTimeline(input, timings);
if (tl.warnings.length) {
  console.error("FAIL  " + tl.warnings.join("\n      "));
  process.exit(1);
}
const out = path.join(dir, "check.mp4");
const started = Date.now();

async function composeWithHyperframes() {
  const clips = [0, 1].map((i) => path.join(dir, `clip-${i}.webm`));
  const alpha = await clipsHaveAlpha(clips, dir);
  if (clips.some((c) => !alpha[c])) throw new Error("a fixture clip has no transparency");
  const project = buildHyperframesProject(tl, {
    background: "#1F2A37",
    clip: (i) => clips[i],
    raster: (key, state) => path.join(dir, `${key}-${state}.png`),
    burnCaptions: true,
  });
  const projectDir = path.join(dir, "hyperframes");
  stageHyperframesProject(project, projectDir);
  const mp4 = await runHyperframesRender(projectDir, project.fps);
  await finishHyperframesRender(mp4, out, tl.duration, dir);
}

function composeWithPython() {
  const config = renderConfig(tl, {
    output: at("check.mp4"),
    background: "#1F2A37",
    palette: compositionPalette(composition),
    clip: (i) => at(`clip-${i}.webm`),
    raster: (key, state) => at(`${key}-${state}.png`),
    burnCaptions: true,
  });
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  run([path.join("scripts", "training", "render.py"), configPath]);
}

function report() {
  if (!fs.existsSync(out) || fs.statSync(out).size < 10_000) {
    console.error("FAIL  the compositor produced no usable file");
    process.exit(1);
  }
  console.log(
    `ok    ${tl.duration.toFixed(1)} s of ${tl.width}x${tl.height} video composed${useHyperframes ? " with HyperFrames" : ""} in ${((Date.now() - started) / 1000).toFixed(1)} s → ${out}`
  );
}

if (useHyperframes) {
  composeWithHyperframes().then(report, (e) => {
    console.error(`FAIL  ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
} else {
  composeWithPython();
  report();
}
