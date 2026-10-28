import { describe, expect, it } from "vitest";
import {
  ANIMATION_PRESETS,
  DEFAULT_COMPOSITION,
  normalizeAnimation,
  normalizeCues,
} from "@/lib/trainingvisuals";
import {
  compileTrainingTimeline,
  estimateSectionTiming,
  type ComposeInput,
} from "@/lib/trainingtimeline";
import { GSAP_FILE, HYPERFRAMES_FPS, buildHyperframesProject } from "@/lib/traininghyperframes";
import { trainingRenderer } from "@/lib/hyperframes";

const S1 = "Welcome to the check. Here is what you will learn today. First the stage, then the panels.";
const S2 = "The pilot built 24 beds. Most residents said they would join.";

function input(animation: keyof typeof ANIMATION_PRESETS = "full"): ComposeInput {
  return {
    title: "Compositor check",
    description: "Synthetic sections.",
    objectives: ["See the stage", "See the panels"],
    composition: {
      ...DEFAULT_COMPOSITION,
      animation: normalizeAnimation(ANIMATION_PRESETS[animation]),
      resolution: "720p",
      sectionCards: true,
      intro: true,
      outro: true,
      captions: "burned",
      lowerThird: { enabled: true, name: "Check Presenter", role: "Renderer" },
    },
    sections: [
      {
        title: "Welcome",
        text: S1,
        cues: normalizeCues([
          {
            kind: "objectives",
            anchor: "Here is what you will learn",
            layout: "side-left",
            transition: "slide",
            bullets: [
              { text: "Stage", anchor: "First the stage" },
              { text: "Panels", anchor: "then the panels" },
            ],
          },
        ]),
      },
      {
        title: "Numbers",
        text: S2,
        cues: normalizeCues([
          { kind: "stat", anchor: "The pilot built 24 beds", layout: "pip", transition: "zoom", stat: { value: "24", label: "beds" } },
          { kind: "quote", anchor: "Most residents said", layout: "full", transition: "wipe", quote: { text: "We would join." } },
        ]),
      },
    ],
  };
}

function timeline(animation: keyof typeof ANIMATION_PRESETS = "full") {
  const i = input(animation);
  return compileTrainingTimeline(i, [
    { ...estimateSectionTiming(S1), duration: 6, source: "avatar" },
    { ...estimateSectionTiming(S2), duration: 5, source: "avatar" },
  ]);
}

const options = {
  background: "#1F2A37",
  clip: (i: number) => `/store/clip-${i}.webm`,
  raster: (key: string, state: number) => `/store/${key}-${state}.png`,
  burnCaptions: true,
};

describe("HyperFrames project", () => {
  it("is a root composition sized and timed like the timeline", () => {
    const tl = timeline();
    const p = buildHyperframesProject(tl, options);
    expect(p.html).toContain(`data-composition-id="root" data-width="${tl.width}" data-height="${tl.height}"`);
    expect(p.html).toContain(`data-start="0" data-duration="${tl.duration}"`);
    expect(p.html).toContain(`<script src="${GSAP_FILE}">`);
    expect(p.html).toContain('window.__timelines["root"] = tl;');
    expect(p.fps).toBe(HYPERFRAMES_FPS);
    expect(p.duration).toBe(tl.duration);
  });

  it("plays each section's presenter clip where the timeline says", () => {
    const tl = timeline();
    const p = buildHyperframesProject(tl, options);
    for (const s of tl.sections) {
      expect(p.html).toContain(`src="assets/clip-${s.index}.webm" data-start="${s.start}" data-duration="${s.duration}"`);
    }
    expect(p.files.filter((f) => f.name.startsWith("assets/clip-")).map((f) => f.from)).toEqual([
      "/store/clip-0.webm",
      "/store/clip-1.webm",
    ]);
  });

  it("refers only to files it lists, once each, with project-relative names", () => {
    const tl = timeline();
    const p = buildHyperframesProject(tl, { ...options, logo: "/store/logo.PNG" });
    const names = p.files.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("assets/logo.png");
    for (const ref of p.html.matchAll(/src="(assets\/[^"]+)"/g)) {
      if (ref[1] !== GSAP_FILE) expect(names).toContain(ref[1]);
    }
    for (const n of names) expect(n.startsWith("/")).toBe(false);
    // Every drawing the timeline needs: each cue state, each card and the lower third.
    const drawings = tl.cues.reduce((n, q) => n + q.states.length, 0) + tl.cards.length + (tl.lowerThird ? 1 : 0);
    expect(names.filter((n) => n.startsWith("assets/r-"))).toHaveLength(drawings);
  });

  it("glides the presenter between the timeline's poses", () => {
    const tl = timeline();
    const p = buildHyperframesProject(tl, options);
    expect(p.html).toMatch(/tl\.set\("#avatar",\{x:0,y:0,scale:1,opacity:1\},0\);/);
    const glides = tl.avatar.filter((k) => k.ease === "inOutSine").length;
    expect(glides).toBeGreaterThan(0);
    expect(p.html.match(/ease:"sine\.inOut",immediateRender:false/g)).toHaveLength(glides);
  });

  it("maps each transition to its arrival", () => {
    const html = buildHyperframesProject(timeline(), options).html;
    expect(html).toContain("opacity:0,x:"); // slide
    expect(html).toContain("scale:.9"); // zoom
    expect(html).toContain('clipPath:"inset(0 100% 0 0)"'); // wipe
    expect(html).toContain('ease:"power3.out"');
  });

  it("reveals build steps over the panel instead of swapping it", () => {
    const tl = timeline();
    const p = buildHyperframesProject(tl, options);
    const objectives = tl.cues[0];
    expect(objectives.states.length).toBeGreaterThan(2);
    expect(p.html).toContain('id="c0s0" src');
    expect(p.html).toMatch(/id="c0s1"[^>]*style="opacity:0"/);
    expect(p.html).toContain(`tl.to("#c0s1",{opacity:1,duration:${tl.timing.reveal},ease:"none"},${objectives.states[1]});`);
  });

  it("fades up from and down to black, and cards fade except at the video's ends", () => {
    const tl = timeline();
    const html = buildHyperframesProject(tl, options).html;
    expect(html).toContain('id="fade"');
    const fadeAt = Math.round((tl.duration - tl.timing.edgeOut) * 1000) / 1000;
    expect(html).toContain(`tl.to("#fade",{opacity:1,duration:${tl.timing.edgeOut},ease:"none"},${fadeAt});`);
    // The intro starts the video and the outro ends it: neither fades on that side.
    const [intro] = tl.cards;
    expect(html).not.toContain(`tl.fromTo("#card0",{opacity:0},{opacity:1,duration:${tl.timing.cardFade},ease:"none"},${intro.start});`);
    expect(html).toContain('tl.fromTo("#card1",{opacity:0}');
  });

  it("burns captions as escaped text, or not at all", () => {
    const tl = timeline();
    expect(tl.captions.length).toBeGreaterThan(0);
    const withText = buildHyperframesProject(
      { ...tl, captions: [{ start: 1, end: 2, text: 'Fish & <chips> "now"' }] },
      options,
    ).html;
    expect(withText).toContain("<span>Fish &amp; &lt;chips&gt; &quot;now&quot;</span>");
    expect(buildHyperframesProject(tl, { ...options, burnCaptions: false }).html).not.toContain('class="cap"');
  });

  it("uses instant cuts and no fades when animation is off", () => {
    const tl = timeline("none");
    const html = buildHyperframesProject(tl, options).html;
    expect(html).not.toContain('id="fade"');
    expect(html).not.toContain('"power3.out"');
    expect(html).not.toContain('tl.to("#c0",{opacity:0');
    expect(html).not.toMatch(/ease:"sine\.inOut"/);
  });

  it("lights the stage from the color, ignoring anything that is not a hex color", () => {
    expect(buildHyperframesProject(timeline(), options).html).toContain("linear-gradient(180deg,rgb(");
    const odd = buildHyperframesProject(timeline(), { ...options, background: "red;} body{display:none" }).html;
    expect(odd).not.toContain("display:none");
  });
});

describe("renderer choice", () => {
  it("defaults to the Python compositor", () => {
    const before = process.env.TRAINING_RENDERER;
    try {
      delete process.env.TRAINING_RENDERER;
      expect(trainingRenderer()).toBe("python");
      process.env.TRAINING_RENDERER = " HyperFrames ";
      expect(trainingRenderer()).toBe("hyperframes");
      process.env.TRAINING_RENDERER = "python";
      expect(trainingRenderer()).toBe("python");
      process.env.TRAINING_RENDERER = "nonsense";
      expect(trainingRenderer()).toBe("python");
    } finally {
      if (before === undefined) delete process.env.TRAINING_RENDERER;
      else process.env.TRAINING_RENDERER = before;
    }
  });
});
