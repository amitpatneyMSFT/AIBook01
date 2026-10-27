import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPOSITION,
  ANIMATION_PRESETS,
  PRESENTER_ONLY,
  TRAINING_VISUALS_INSTRUCTION,
  anchorAt,
  findAnchor,
  hashText,
  normalizeComposition,
  normalizeAnimation,
  normalizeCue,
  normalizeCues,
  normalizeVisualPlan,
  type TrainingComposition,
  type TrainingCue,
} from "@/lib/trainingvisuals";
import {
  CUE_IN_S,
  INTRO_S,
  LAYOUT_MOVE_S,
  MIN_CUE_GAP,
  OUTRO_S,
  SECTION_CARD_S,
  compileTrainingTimeline,
  estimateSectionTiming,
  layoutGeometry,
  rasterJobs,
  renderConfig,
  sampleAvatar,
  splitSentences,
  stateAt,
  toWebVtt,
  usableTimings,
  type ComposeInput,
  type SectionTiming,
} from "@/lib/trainingtimeline";
import { normalizeSections } from "@/lib/training";

const S1 =
  "Welcome to this session. Today you will learn three things about garden pilots.\n\n" +
  "First, why volunteers matter. Second, how to budget. Third, how to measure results.";
const S2 =
  "The pilot built 24 beds in one spring. That took about 68 percent of the budget. " +
  "Most residents said they would join a workshop.";

const comp = (over: Partial<TrainingComposition> = {}): TrainingComposition => ({
  ...DEFAULT_COMPOSITION,
  lowerThird: { enabled: true, name: "Lisa", role: "Trainer" },
  ...over,
});

const cue = (over: Partial<TrainingCue>): TrainingCue => ({
  id: "c" + Math.random().toString(36).slice(2, 8),
  kind: "bullets",
  anchor: "",
  layout: "side-left",
  transition: "slide",
  ...over,
});

const input = (over: Partial<ComposeInput> = {}): ComposeInput => ({
  title: "Garden pilots",
  description: "Run one well.",
  objectives: ["Explain volunteers", "Plan a budget", "Measure results"],
  sections: [
    {
      title: "Welcome",
      text: S1,
      cues: [
        cue({ kind: "title", anchor: "Welcome to this session", title: "Garden pilots" }),
        cue({
          kind: "objectives",
          anchor: "Today you will learn three things",
          bullets: [
            { text: "Volunteers", anchor: "First, why volunteers matter" },
            { text: "Budget", anchor: "Second, how to budget" },
            { text: "Results" },
          ],
        }),
      ],
    },
    {
      title: "The numbers",
      text: S2,
      cues: [
        cue({ kind: "stat", anchor: "That took about 68 percent", stat: { value: "68%", label: "of budget" }, layout: "pip" }),
        cue({ kind: "presenter", anchor: "Most residents said", layout: "presenter" }),
      ],
    },
  ],
  composition: comp(),
  ...over,
});

describe("anchors", () => {
  it("matches ignoring case and punctuation", () => {
    expect(findAnchor(S1, "first why VOLUNTEERS matter")).toEqual({ word: 13, exact: true });
  });

  it("accepts a close match after a small edit", () => {
    const m = findAnchor(S2, "That took roughly 68 percent of");
    expect(m?.exact).toBe(false);
    expect(m?.word).toBe(findAnchor(S2, "That took about 68 percent")?.word);
  });

  it("rejects phrases that are not there", () => {
    expect(findAnchor(S2, "quantum entanglement of carrots")).toBeNull();
    expect(findAnchor(S2, "")).toBeNull();
  });

  it("builds an anchor from a cursor position", () => {
    expect(anchorAt(S2, S2.indexOf("68"), 3)).toBe("68 percent of");
  });
});

describe("cue and composition normalizers", () => {
  it("preserves old animation defaults and normalizes individual toggles", () => {
    expect(normalizeComposition({}).animation).toEqual(normalizeAnimation(undefined));
    expect(normalizeAnimation(null)).toEqual(normalizeAnimation(undefined));
    expect(normalizeAnimation({ transitions: false, pictures: "false", bullets: 0, layout: false })).toEqual({
      transitions: false, pictures: true, bullets: true, layout: false,
    });
    for (const preset of Object.values(ANIMATION_PRESETS)) {
      const animation = normalizeAnimation(preset);
      expect(normalizeComposition({ animation }).animation).toEqual(animation);
      expect(animation).not.toHaveProperty("label");
    }
  });

  it("treats an artifact without composition as presenter only", () => {
    expect(normalizeComposition(undefined)).toEqual(PRESENTER_ONLY);
    expect(normalizeComposition({}).mode).toBe("composed");
  });

  it("clamps composition values", () => {
    const c = normalizeComposition({
      mode: "composed",
      palette: "nope",
      defaultLayout: "presenter",
      captions: "loud",
      resolution: "8k",
      logoId: "../x",
      lowerThird: { enabled: true, name: "x".repeat(100) },
    });
    expect(c.palette).toBe(DEFAULT_COMPOSITION.palette);
    expect(c.defaultLayout).toBe(DEFAULT_COMPOSITION.defaultLayout);
    expect(c.captions).toBe("burned");
    expect(c.resolution).toBe("720p");
    expect(c.logoId).toBeUndefined();
    expect(c.lowerThird.name).toHaveLength(60);
  });

  it("drops cues with nothing to show and fixes layouts", () => {
    expect(normalizeCue({ kind: "stat", anchor: "x" })).toBeNull();
    expect(normalizeCue({ kind: "image", anchor: "x" })).toBeNull();
    expect(normalizeCue({ kind: "presenter", anchor: "x", layout: "pip" })?.layout).toBe("presenter");
    expect(normalizeCue({ kind: "title", title: "Hi", layout: "presenter" })?.layout).toBe("side-left");
    const c = normalizeCue({ kind: "bullets", bullets: ["a", { text: "b", anchor: "c" }, {}], offsetSec: 99 });
    expect(c?.bullets).toEqual([{ text: "a" }, { text: "b", anchor: "c" }]);
    expect(c?.offsetSec).toBe(10);
    expect(normalizeCue({ kind: "screenshot", anchor: "x" })?.kenBurns).toBe(true);
  });

  it("gives duplicate ids fresh ones", () => {
    const cues = normalizeCues([
      { id: "abcd1234", kind: "title", title: "A" },
      { id: "abcd1234", kind: "title", title: "B" },
    ]);
    expect(new Set(cues.map((c) => c.id)).size).toBe(2);
  });

  it("keeps cues on sections through the transcript normalizer", () => {
    const [s] = normalizeSections([{ title: "A", text: "Hello there.", cues: [{ kind: "title", title: "Hi" }] }]);
    expect(s.cues?.[0].kind).toBe("title");
    const [plain] = normalizeSections([{ title: "A", text: "Hello there." }]);
    expect(plain.cues).toBeUndefined();
  });
});

describe("visual plan", () => {
  it("asks for verbatim anchors and lists only available kinds", () => {
    const p = TRAINING_VISUALS_INSTRUCTION({ images: false, infographics: [] });
    expect(p).toMatch(/EXACTLY/);
    expect(p).not.toMatch(/"image"/);
    expect(p).not.toMatch(/NOTEBOOK INFOGRAPHICS/);
    const q = TRAINING_VISUALS_INSTRUCTION({ images: true, infographics: [{ id: "abc", title: "Pilot" }] });
    expect(q).toMatch(/"image"/);
    expect(q).toMatch(/- abc: Pilot/);
  });

  it("drops cues with anchors not in the section and orders by speech", () => {
    const plan = normalizeVisualPlan(
      {
        sections: [
          {
            section: 2,
            cues: [
              { kind: "presenter", anchor: "Most residents said" },
              { kind: "stat", anchor: "That took about 68 percent", stat: { value: "68%", label: "budget" } },
              { kind: "title", anchor: "not in the script at all", title: "x" },
              { kind: "infographic", anchor: "The pilot built 24 beds", infographicId: "missing" },
              { kind: "image", anchor: "The pilot built 24 beds", imagePrompt: "beds", caption: "Raised beds" },
              { kind: "bullets", anchor: "The pilot built", bullets: [{ text: "x", anchor: "nowhere here" }] },
            ],
          },
        ],
      },
      [{ text: S1 }, { text: S2 }],
      { images: false, infographicIds: [] }
    );
    expect(plan[0]).toEqual([]);
    expect(plan[1].map((c) => c.kind)).toEqual(["quote", "stat", "presenter"]);
  });
});

describe("timeline", () => {
  it("disables all visual animation without losing content, timing, or delayed answers", () => {
    const source = input();
    source.sections[1].cues![0].kenBurns = true;
    source.sections[1].cues![1] = cue({
      kind: "check", anchor: "Most residents said",
      question: "Would residents join?", answer: "Yes.",
    });
    const full = compileTrainingTimeline(source, []);
    const none = compileTrainingTimeline({
      ...source,
      composition: comp({ animation: normalizeAnimation(ANIMATION_PRESETS.none) }),
    }, []);
    expect(none.sections).toEqual(full.sections);
    expect(none.cards).toEqual(full.cards);
    expect(none.captions).toEqual(full.captions);
    expect(none.duration).toBe(full.duration);
    expect(Object.values(none.timing).every((seconds) => seconds === 0)).toBe(true);
    expect(none.cues.every((q) => q.transition === "cut" && !q.kenBurns)).toBe(true);
    const objectives = none.cues.find((q) => q.kind === "objectives")!;
    expect(objectives.states).toEqual(Array(4).fill(objectives.start));
    expect(stateAt(objectives, objectives.start)).toBe(3);
    const check = none.cues.find((q) => q.kind === "check")!;
    expect(stateAt(check, check.start)).toBe(0);
    expect(check.states[1]).toBeGreaterThan(check.start);
    expect(check.states).toEqual(full.cues.find((q) => q.kind === "check")!.states);
    expect(none.cues.map((q) => q.rasterKey)).toEqual(full.cues.map((q) => q.rasterKey));
    expect(source.sections[1].cues![0].kenBurns).toBe(true);
    expect(source.sections[0].cues![0].transition).toBe("slide");

    const config = renderConfig(none, {
      output: "test.mp4", background: "#000000", palette: {},
      clip: (section) => `clip-${section}.webm`,
      raster: (key, state) => `${key}-${state}.png`,
      burnCaptions: true,
    });
    expect(config.timing).toEqual(none.timing);
    expect(config.cues[1].states[3]).toEqual({
      at: objectives.start, src: `${objectives.rasterKey}-3.png`,
    });
  });

  it("applies each animation toggle independently", () => {
    const source = input();
    source.sections[1].cues![0].kenBurns = true;
    const full = compileTrainingTimeline(source, []);
    for (const key of ["transitions", "pictures", "bullets", "layout"] as const) {
      const changed = compileTrainingTimeline({
        ...source,
        composition: comp({ animation: { ...normalizeAnimation(undefined), [key]: false } }),
      }, []);
      expect(changed.cues.map((q) => q.transition)).toEqual(
        full.cues.map((q) => key === "transitions" ? "cut" : q.transition)
      );
      expect(changed.cues.map((q) => q.kenBurns)).toEqual(
        full.cues.map((q) => key !== "pictures" && q.kenBurns)
      );
      if (key !== "bullets") expect(changed.cues.map((q) => q.states)).toEqual(full.cues.map((q) => q.states));
      if (key !== "layout") expect(changed.avatar).toEqual(full.avatar);
      if (key !== "transitions") expect(changed.timing).toEqual(full.timing);
    }
  });

  it("cuts presenter layouts exactly at the cue boundary when gliding is off", () => {
    const source = input({ composition: comp({ animation: normalizeAnimation(ANIMATION_PRESETS.none) }) });
    const tl = compileTrainingTimeline(source, []);
    const stat = tl.cues.find((q) => q.kind === "stat")!;
    const target = layoutGeometry("pip", source.composition).avatar;
    expect(sampleAvatar(tl.avatar, stat.start - 0.01).scale).toBe(1);
    expect(sampleAvatar(tl.avatar, stat.start)).toEqual(target);
    expect(sampleAvatar(tl.avatar, stat.start + LAYOUT_MOVE_S / 2)).toEqual(target);
    const first = tl.cues[0];
    expect(sampleAvatar(tl.avatar, first.start)).toEqual(layoutGeometry(first.layout, source.composition).avatar);
  });

  it("splits sentences and marks paragraph ends", () => {
    const s = splitSentences(S1);
    expect(s.map((x) => x.paragraphEnd)).toEqual([false, true, false, false, true]);
    expect(s[2].firstWord).toBe(13);
  });

  it("only trusts timings measured for the current text", () => {
    const fresh: SectionTiming = { ...estimateSectionTiming(S2), duration: 30, source: "tts" };
    const stale: SectionTiming = { ...fresh, textHash: hashText("old") };
    const [a, b] = usableTimings([{ text: S2 }, { text: S2 }], [fresh, stale]);
    expect(a.source).toBe("tts");
    expect(b.source).toBe("estimate");
  });

  it("places cards, sections and cues on one clock", () => {
    const t1: SectionTiming = { ...estimateSectionTiming(S1), duration: 20, source: "avatar" };
    const t2: SectionTiming = { ...estimateSectionTiming(S2), duration: 15, source: "avatar" };
    const tl = compileTrainingTimeline(input(), [t1, t2]);

    expect(tl.cards.map((c) => c.role)).toEqual(["intro", "section", "outro"]);
    expect(tl.sections[0].start).toBe(INTRO_S);
    expect(tl.sections[1].start).toBeCloseTo(INTRO_S + 20 + SECTION_CARD_S, 3);
    expect(tl.duration).toBeCloseTo(INTRO_S + 20 + SECTION_CARD_S + 15 + OUTRO_S, 3);
    expect(tl.warnings).toEqual([]);

    const [title, objectives, stat] = tl.cues;
    expect(title.start).toBe(INTRO_S);
    expect(objectives.start).toBeGreaterThan(title.start);
    expect(title.end).toBe(objectives.start);
    expect(objectives.end).toBeCloseTo(INTRO_S + 20, 3);
    // Title, then one state per objective, each revealed in spoken order.
    expect(objectives.states).toHaveLength(4);
    for (let i = 1; i < objectives.states.length; i++) {
      expect(objectives.states[i]).toBeGreaterThan(objectives.states[i - 1]);
    }
    expect(stateAt(objectives, objectives.states[2] + 0.01)).toBe(2);
    // The stat ends where "Most residents said" returns to the presenter.
    expect(stat.layout).toBe("pip");
    expect(stat.end).toBeLessThan(tl.sections[1].start + 15);
    expect(tl.cues.some((c) => c.kind === "presenter")).toBe(false);
  });

  it("moves the presenter into each layout as its cue arrives", () => {
    const t = [estimateSectionTiming(S1), estimateSectionTiming(S2)];
    const tl = compileTrainingTimeline(input(), t);
    const stat = tl.cues.find((c) => c.kind === "stat")!;
    const pip = layoutGeometry("pip", tl.cues[0] ? comp() : comp()).avatar;
    const after = sampleAvatar(tl.avatar, stat.start + LAYOUT_MOVE_S + 0.01);
    expect(after.scale).toBeCloseTo(pip.scale, 5);
    expect(after.cx).toBeCloseTo(pip.cx, 5);
    // Each section starts on the full presenter.
    const atSection = sampleAvatar(tl.avatar, tl.sections[1].start + 0.01);
    expect(atSection.scale).toBeCloseTo(1, 2);
  });

  it("draws talking heads smaller than full-body presenters and keeps them on screen", () => {
    for (const layout of ["side-left", "side-right", "pip"] as const) {
      for (const pipSize of ["small", "medium", "large"] as const) {
        const c = { ...comp(), pipSize, pipCorner: "bottom-left" as const };
        const body = layoutGeometry(layout, c).avatar;
        const head = layoutGeometry(layout, c, "", true).avatar;
        expect(head.scale).toBeLessThan(body.scale);
        expect(head.cx - head.scale / 2).toBeGreaterThanOrEqual(-0.001);
        expect(head.cx + head.scale / 2).toBeLessThanOrEqual(1.001);
        expect(head.cy + head.scale / 2).toBeLessThanOrEqual(1.001);
      }
    }
  });

  it("keeps cues apart and warns about missing anchors", () => {
    const i = input();
    i.sections[1].cues = [
      cue({ kind: "title", anchor: "The pilot built", title: "A" }),
      cue({ kind: "title", anchor: "The pilot built 24", title: "B" }),
      cue({ kind: "title", anchor: "nowhere to be seen", title: "C" }),
    ];
    const tl = compileTrainingTimeline(i, [null, null]);
    const cues = tl.cues.filter((c) => c.section === 1);
    expect(cues[1].start - cues[0].start).toBeGreaterThanOrEqual(MIN_CUE_GAP - 1e-6);
    expect(cues.find((c) => c.match === "missing")).toBeTruthy();
    expect(tl.warnings[0]).toMatch(/nowhere to be seen/);
  });

  it("draws every visual once and re-keys only on content changes", () => {
    const a = rasterJobs(input());
    expect(a.map((j) => j.role)).toEqual(["intro", "cue", "cue", "section", "cue", "outro", "lower"]);
    const moved = input();
    moved.sections[1].cues![0].anchor = "The pilot built";
    moved.sections[1].cues![0].offsetSec = 2;
    expect(rasterJobs(moved).map((j) => j.key)).toEqual(a.map((j) => j.key));
    const edited = input();
    edited.sections[1].cues![0].stat = { value: "70%", label: "of budget" };
    expect(rasterJobs(edited)[4].key).not.toBe(a[4].key);
    const objectives = a.find((j) => j.cueId === input().sections[0].cues![1].id) ?? a[2];
    expect(objectives.states).toBe(4);
  });

  it("emits captions as WebVTT, or none when switched off", () => {
    const tl = compileTrainingTimeline(input(), [null, null]);
    expect(tl.captions.length).toBeGreaterThan(4);
    const vtt = toWebVtt(tl.captions);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toMatch(/00:00:03\.500 --> /);
    const off = compileTrainingTimeline(input({ composition: comp({ captions: "off" }) }), [null, null]);
    expect(off.captions).toEqual([]);
  });

  it("names the presenter on their side, and not while they are in a corner", () => {
    const left = compileTrainingTimeline(input(), [null, null]);
    expect(left.lowerThird?.rect.x).toBe(0.03);
    const right = input();
    right.sections[0].cues!.forEach((q) => (q.layout = "side-right"));
    expect(compileTrainingTimeline(right, [null, null]).lowerThird?.rect.x).toBeCloseTo(0.63, 5);
    const corner = input();
    corner.sections[0].cues![0].layout = "pip";
    expect(compileTrainingTimeline(corner, [null, null]).lowerThird).toBeNull();
  });

  it("keeps crowded visuals inside their section", () => {
    const i = input({ composition: comp({ intro: false, outro: false, sectionCards: false }) });
    i.sections[1].cues = ["Take a moment", "remember that number", "a moment to remember", "that number"].map(
      (anchor, n) => cue({ kind: "title", anchor, title: `T${n}` })
    );
    const tl = compileTrainingTimeline(i, [null, { ...estimateSectionTiming(S2), duration: 9 }]);
    const s = tl.sections[1];
    const cues = tl.cues.filter((q) => q.section === 1);
    for (const q of cues) {
      expect(q.start).toBeGreaterThanOrEqual(s.start);
      expect(q.end).toBeLessThanOrEqual(s.start + s.duration + 1e-6);
    }
    for (let k = 1; k < cues.length; k++) expect(cues[k].start).toBeGreaterThanOrEqual(cues[k - 1].end - 1e-6);
  });

  it("omits cards when they are switched off", () => {
    const tl = compileTrainingTimeline(
      input({ composition: comp({ intro: false, outro: false, sectionCards: false }) }),
      [null, null]
    );
    expect(tl.cards).toEqual([]);
    expect(tl.sections[0].start).toBe(0);
    expect(tl.cues[0].start).toBeLessThan(CUE_IN_S);
  });
});
