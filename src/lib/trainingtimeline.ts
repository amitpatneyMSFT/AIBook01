/**
 * Turns a composed training video's transcript, cues and measured speech into
 * one absolute timeline: when each section's presenter clip plays, when every
 * visual slides in and every bullet is revealed, where the presenter stands,
 * and when each caption shows.
 *
 * The same timeline drives the in-browser preview and the compositor
 * (scripts/training/render.py), so what the user previews is what renders.
 * Positions are fractions of the frame; the renderer scales them.
 *
 * Pure and client-safe, so it can be tested and run live in the editor.
 */
import { WORDS_PER_MINUTE } from "./voices";
import type { TrainingSection } from "./types";
import {
  compositionPalette,
  findAnchor,
  hashText,
  normalizeComposition,
  PIP_SCALES,
  resolvePip,
  tokenize,
  TRAINING_RESOLUTIONS,
  type CueKind,
  type CueTransition,
  type TrainingBullet,
  type TrainingComposition,
  type TrainingCue,
  type TrainingLayout,
} from "./trainingvisuals";
import { caseVocabulary, casedCue, fixCase, type CaseVocabulary } from "./slidecase";

export const INTRO_S = 3.5;
export const OUTRO_S = 3.5;
export const SECTION_CARD_S = 2.2;
/** How long the presenter takes to glide between layouts. */
export const LAYOUT_MOVE_S = 0.6;
export const CUE_IN_S = 0.5;
export const CUE_OUT_S = 0.35;
export const REVEAL_S = 0.35;
export const LOWER_THIRD_AT = 1.2;
export const LOWER_THIRD_S = 5;
/** Two visuals closer together than this would flash past. */
export const MIN_CUE_GAP = 0.8;
/** Pause the avatar SSML puts between paragraphs (buildTrainingSsml). */
export const PARAGRAPH_PAUSE = 0.45;
const MAX_CAPTION_WORDS = 14;

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// Sentences and speech timing
// ---------------------------------------------------------------------------

export type Sentence = {
  text: string;
  /** Index of the sentence's first word in tokenize(section text). */
  firstWord: number;
  words: number;
  paragraphEnd: boolean;
};

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let word = 0;
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const p of paragraphs) {
    const parts = p
      .split(/(?<=[.!?…]["'”’)\]]*)\s+(?=["'“‘(\[]?[\p{Lu}\p{N}])/u)
      .map((s) => s.trim())
      .filter(Boolean);
    parts.forEach((s, i) => {
      const words = tokenize(s).length;
      if (!words) return;
      out.push({ text: s, firstWord: word, words, paragraphEnd: i === parts.length - 1 });
      word += words;
    });
  }
  return out;
}

/** Seconds a sentence takes at the presenter's pace, for when nothing was measured. */
export function estimateSentenceSeconds(s: Sentence): number {
  const pause = /[.!?…]["'”’)\]]*$/.test(s.text) ? 0.3 : 0.1;
  return s.words / (WORDS_PER_MINUTE / 60) + pause + (s.paragraphEnd ? PARAGRAPH_PAUSE : 0);
}

export type SectionTiming = {
  /** Real length of the section's speech: the avatar clip when rendered. */
  duration: number;
  /** Relative weight (seconds) of each sentence; scaled to `duration`. */
  sentences: number[];
  /** hashText of the section text the timing was measured for. */
  textHash: string;
  source: "avatar" | "tts" | "estimate";
  /** Section voice track for the preview: TTS audio or the presenter clip. */
  audioUrl?: string;
  /** Transparent presenter clip, once rendered. */
  clipUrl?: string;
};

export function estimateSectionTiming(text: string): SectionTiming {
  const sentences = splitSentences(text).map(estimateSentenceSeconds);
  return {
    duration: round(sentences.reduce((a, b) => a + b, 0)),
    sentences: sentences.map(round),
    textHash: hashText(text),
    source: "estimate",
  };
}

/**
 * Timings that still describe the current text; anything stale (the user has
 * edited the section since it was measured) is replaced by an estimate.
 */
export function usableTimings(
  sections: Pick<TrainingSection, "text">[],
  timings: (SectionTiming | null | undefined)[]
): SectionTiming[] {
  return sections.map((s, i) => {
    const t = timings[i];
    if (
      t &&
      t.textHash === hashText(s.text) &&
      t.sentences.length === splitSentences(s.text).length &&
      t.duration > 0
    ) {
      return t;
    }
    return estimateSectionTiming(s.text);
  });
}

/** Section-local start time of every sentence, scaled to the real duration. */
function sentenceStarts(timing: SectionTiming, count: number): { start: number; end: number }[] {
  const w = timing.sentences.length === count ? timing.sentences : Array(count).fill(1);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  const k = timing.duration / total;
  let clock = 0;
  return w.map((x) => {
    const start = clock;
    clock += x * k;
    return { start, end: clock };
  });
}

/** Section-local time at which word `index` is spoken. */
function wordTime(sentences: Sentence[], spans: { start: number; end: number }[], index: number): number {
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (index < s.firstWord + s.words) {
      const frac = Math.max(0, index - s.firstWord) / s.words;
      return spans[i].start + frac * (spans[i].end - spans[i].start);
    }
  }
  return spans.at(-1)?.end ?? 0;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export type Rect = { x: number; y: number; w: number; h: number };
/** The full presenter frame, centered at (cx, cy) and scaled; all fractions. */
export type AvatarPose = { cx: number; cy: number; scale: number; opacity: number };

export const PRESENTER_POSE: AvatarPose = { cx: 0.5, cy: 0.5, scale: 1, opacity: 1 };

/** Presenter size beside a visual; cy = 1 - scale / 2 keeps the shoulders on the bottom edge. */
const SIDE_SCALE = 0.5;

export function layoutGeometry(
  layout: TrainingLayout,
  comp: Pick<TrainingComposition, "captions" | "pipCorner" | "pipSize">,
  cueId = ""
): { avatar: AvatarPose; panel: Rect | null } {
  const bottom = comp.captions === "burned" ? 0.84 : 0.92;
  switch (layout) {
    case "side-left":
      return {
        avatar: { cx: 0.18, cy: 0.75, scale: SIDE_SCALE, opacity: 1 },
        panel: { x: 0.36, y: 0.08, w: 0.61, h: round(bottom - 0.08) },
      };
    case "side-right":
      return {
        avatar: { cx: 0.82, cy: 0.75, scale: SIDE_SCALE, opacity: 1 },
        panel: { x: 0.03, y: 0.08, w: 0.61, h: round(bottom - 0.08) },
      };
    case "pip": {
      const { corner, size } = resolvePip(comp, cueId);
      const scale = PIP_SCALES[size];
      const grow = (scale - PIP_SCALES.medium) * 0.5;
      const right = corner.endsWith("right");
      const low = corner.startsWith("bottom");
      return {
        avatar: {
          cx: round(right ? 0.88 - grow : 0.12 + grow),
          cy: round(low ? 0.8 - grow : 0.26 + grow),
          scale,
          opacity: 1,
        },
        panel: { x: 0.03, y: 0.05, w: 0.94, h: round(bottom - 0.05) },
      };
    }
    case "full":
      return {
        avatar: { ...PRESENTER_POSE, opacity: 0 },
        panel: { x: 0, y: 0, w: 1, h: 1 },
      };
    case "presenter":
    default:
      return { avatar: PRESENTER_POSE, panel: null };
  }
}

export const LOWER_THIRD_RECT: Rect = { x: 0.03, y: 0.66, w: 0.34, h: 0.12 };
export const FULL_RECT: Rect = { x: 0, y: 0, w: 1, h: 1 };

export function frameSize(comp: Pick<TrainingComposition, "resolution">) {
  return TRAINING_RESOLUTIONS[comp.resolution] ?? TRAINING_RESOLUTIONS["720p"];
}

export const rectPixels = (r: Rect, comp: Pick<TrainingComposition, "resolution">) => {
  const { width, height } = frameSize(comp);
  return { w: Math.round(r.w * width), h: Math.round(r.h * height) };
};

// ---------------------------------------------------------------------------
// Rasters: every picture the browser draws for the compositor
// ---------------------------------------------------------------------------

export type ComposeInput = {
  title: string;
  description?: string;
  objectives: string[];
  sections: TrainingSection[];
  composition: TrainingComposition;
};

/** The parts of a training artifact the timeline and the rasters depend on. */
export const composeInputOf = (c: {
  title: string;
  description?: string;
  objectives?: string[];
  sections: TrainingSection[];
  composition?: unknown;
}): ComposeInput => ({
  title: c.title,
  description: c.description,
  objectives: c.objectives ?? [],
  sections: c.sections,
  composition: normalizeComposition(c.composition),
});

export type RasterJob = {
  key: string;
  role: "cue" | "intro" | "section" | "outro" | "lower";
  /** Section index for cues and section cards. */
  section?: number;
  cueId?: string;
  /** Number of build states (bullets revealed one by one, a check's answer). */
  states: number;
  width: number;
  height: number;
};

/** How many pictures a cue needs: one per build step. */
export function cueStates(cue: TrainingCue, objectives: string[]): number {
  if (cue.kind === "bullets" || cue.kind === "objectives") {
    return cueBullets(cue, objectives).length + 1;
  }
  if (cue.kind === "check") return cue.answer ? 2 : 1;
  return 1;
}

export function cueBullets(cue: TrainingCue, objectives: string[]): TrainingBullet[] {
  if (cue.bullets?.length) return cue.bullets;
  if (cue.kind === "objectives") return objectives.slice(0, 6).map((text) => ({ text }));
  return [];
}

const VISUAL_VERSION = 2;

/** How the script writes its names, for capitalizing slide text (src/lib/slidecase.ts). */
export function composeVocabulary(input: Pick<ComposeInput, "sections" | "description" | "objectives">): CaseVocabulary {
  return caseVocabulary([...input.sections.map((s) => s.text), input.description, ...input.objectives]);
}

function cueKey(cue: TrainingCue, input: ComposeInput, px: { w: number; h: number }, vocab: CaseVocabulary): string {
  const c = input.composition;
  const shown = casedCue(cue, vocab);
  return hashText(
    JSON.stringify([
      VISUAL_VERSION,
      shown.kind,
      shown.title,
      shown.subtitle,
      cueBullets(shown, input.objectives.map((o) => fixCase(o, vocab))).map((b) => b.text),
      shown.stat,
      shown.quote,
      shown.question,
      shown.answer,
      shown.infographicId,
      shown.imageId,
      shown.imageCredit,
      shown.caption,
      px,
      c.palette,
    ])
  );
}

export function rasterJobs(input: ComposeInput): RasterJob[] {
  const c = input.composition;
  const jobs: RasterJob[] = [];
  const full = rectPixels(FULL_RECT, c);
  const pal = c.palette;
  const vocab = composeVocabulary(input);
  const cased = (s: string | undefined) => fixCase(s, vocab);
  if (c.intro) {
    jobs.push({
      key: hashText(JSON.stringify([VISUAL_VERSION, "intro", cased(input.title), cased(input.description), full, pal])),
      role: "intro",
      states: 1,
      width: full.w,
      height: full.h,
    });
  }
  input.sections.forEach((s, i) => {
    if (c.sectionCards && !(i === 0 && c.intro)) {
      jobs.push({
        key: hashText(JSON.stringify([VISUAL_VERSION, "section", i, cased(s.title), input.sections.length, full, pal])),
        role: "section",
        section: i,
        states: 1,
        width: full.w,
        height: full.h,
      });
    }
    for (const cue of s.cues ?? []) {
      const { panel } = layoutGeometry(cue.layout, c);
      if (!panel || cue.kind === "presenter") continue;
      const px = rectPixels(panel, c);
      jobs.push({
        key: cueKey(cue, input, px, vocab),
        role: "cue",
        section: i,
        cueId: cue.id,
        states: cueStates(cue, input.objectives),
        width: px.w,
        height: px.h,
      });
    }
  });
  if (c.outro) {
    jobs.push({
      key: hashText(JSON.stringify([VISUAL_VERSION, "outro", cased(input.title), full, pal])),
      role: "outro",
      states: 1,
      width: full.w,
      height: full.h,
    });
  }
  if (c.lowerThird.enabled && c.lowerThird.name.trim()) {
    const px = rectPixels(LOWER_THIRD_RECT, c);
    jobs.push({
      key: hashText(JSON.stringify([VISUAL_VERSION, "lower", c.lowerThird.name, c.lowerThird.role, px, pal])),
      role: "lower",
      states: 1,
      width: px.w,
      height: px.h,
    });
  }
  // A cue repeated verbatim draws once.
  const seen = new Set<string>();
  return jobs.filter((j) => (seen.has(j.key) ? false : (seen.add(j.key), true)));
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

export type TimelineCue = {
  id: string;
  section: number;
  kind: CueKind;
  layout: TrainingLayout;
  transition: CueTransition;
  start: number;
  end: number;
  panel: Rect | null;
  rasterKey: string | null;
  /** Absolute time each build state appears; state 0 at `start`. */
  states: number[];
  kenBurns: boolean;
  /** The anchor only matched approximately, or not at all. */
  match: "exact" | "approx" | "missing";
};

export type TimelineCard = {
  role: "intro" | "section" | "outro";
  section?: number;
  start: number;
  duration: number;
  rasterKey: string;
};

export type AvatarKeyframe = AvatarPose & { t: number; ease: "linear" | "inOutSine" };

export type TrainingTimeline = {
  width: number;
  height: number;
  duration: number;
  /** Where each section's speech (its presenter clip) plays. */
  sections: { index: number; title: string; start: number; duration: number }[];
  cards: TimelineCard[];
  cues: TimelineCue[];
  avatar: AvatarKeyframe[];
  captions: { start: number; end: number; text: string }[];
  lowerThird: { start: number; end: number; rasterKey: string; rect: Rect } | null;
  warnings: string[];
};

function captionChunks(sentence: string): string[] {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_CAPTION_WORDS) return [sentence];
  const n = Math.ceil(words.length / MAX_CAPTION_WORDS);
  const per = Math.ceil(words.length / n);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(" "));
  return out;
}

export function compileTrainingTimeline(
  input: ComposeInput,
  timingsIn: (SectionTiming | null | undefined)[]
): TrainingTimeline {
  const c = input.composition;
  const { width, height } = frameSize(c);
  const timings = usableTimings(input.sections, timingsIn);
  const jobs = rasterJobs(input);
  const keyFor = (role: RasterJob["role"], section?: number, cueId?: string) =>
    jobs.find(
      (j) =>
        j.role === role &&
        (section === undefined || j.section === section) &&
        (cueId === undefined || j.cueId === cueId)
    )?.key ?? null;
  // Duplicate cues share a key, so look them up by content rather than id.
  const vocab = composeVocabulary(input);
  const cueKeyOf = (cue: TrainingCue) => {
    const { panel } = layoutGeometry(cue.layout, c);
    return panel && cue.kind !== "presenter" ? cueKey(cue, input, rectPixels(panel, c), vocab) : null;
  };

  const warnings: string[] = [];
  const cards: TimelineCard[] = [];
  const cues: TimelineCue[] = [];
  const captions: TrainingTimeline["captions"] = [];
  const sections: TrainingTimeline["sections"] = [];
  const avatar: AvatarKeyframe[] = [];
  let clock = 0;
  let pose: AvatarPose = PRESENTER_POSE;

  const setPose = (t: number, next: AvatarPose, instant = false) => {
    const same =
      pose.cx === next.cx && pose.cy === next.cy && pose.scale === next.scale && pose.opacity === next.opacity;
    if (same) return;
    // Keyframes stay in time order even when a cue starts with its section.
    const from = Math.max(t, avatar.at(-1)?.t ?? 0);
    avatar.push({ t: round(from), ...pose, ease: "linear" });
    avatar.push({ t: round(from + (instant ? 0.001 : LAYOUT_MOVE_S)), ...next, ease: "inOutSine" });
    pose = next;
  };

  if (c.intro) {
    const key = keyFor("intro");
    if (key) cards.push({ role: "intro", start: 0, duration: INTRO_S, rasterKey: key });
    clock += INTRO_S;
  }

  input.sections.forEach((section, i) => {
    if (c.sectionCards && !(i === 0 && c.intro)) {
      const key = keyFor("section", i);
      if (key) cards.push({ role: "section", section: i, start: round(clock), duration: SECTION_CARD_S, rasterKey: key });
      clock += SECTION_CARD_S;
    }
    const timing = timings[i];
    const start = clock;
    const duration = timing.duration;
    const end = start + duration;
    sections.push({ index: i, title: section.title, start: round(start), duration: round(duration) });
    setPose(start, PRESENTER_POSE, true);

    const sentences = splitSentences(section.text);
    const spans = sentenceStarts(timing, sentences.length);
    const words = tokenize(section.text);
    const at = (phrase: string | undefined): { t: number; exact: boolean } | null => {
      if (!phrase) return null;
      const m = findAnchor(section.text, phrase, words);
      return m ? { t: wordTime(sentences, spans, m.word), exact: m.exact } : null;
    };

    sentences.forEach((s, k) => {
      const chunks = captionChunks(s.text);
      const span = spans[k];
      // The paragraph pause is silence; captions should not linger into it.
      const speech = (span.end - span.start) * (s.paragraphEnd ? 0.9 : 1);
      const total = chunks.reduce((n, ch) => n + ch.split(/\s+/).length, 0);
      let offset = 0;
      for (const ch of chunks) {
        const n = ch.split(/\s+/).length;
        captions.push({
          start: round(start + span.start + (speech * offset) / total),
          end: round(start + span.start + (speech * (offset + n)) / total),
          text: ch,
        });
        offset += n;
      }
    });

    // Place each cue at its anchor; unmatched ones keep their listed order.
    const list = section.cues ?? [];
    const placed = list.map((cue, n) => {
      const m = at(cue.anchor);
      if (!m) {
        warnings.push(
          `Section ${i + 1}: the words "${cue.anchor || "(none)"}" for a ${cue.kind} visual are not in the script, so it is placed by its order.`
        );
      }
      const base = m ? m.t : (duration * (n + 1)) / (list.length + 1);
      return {
        cue,
        match: (m ? (m.exact ? "exact" : "approx") : "missing") as TimelineCue["match"],
        t: Math.max(0, Math.min(duration - MIN_CUE_GAP, base + (cue.offsetSec ?? 0))),
      };
    });
    placed.sort((a, b) => a.t - b.t);
    for (let k = 1; k < placed.length; k++) {
      if (placed[k].t < placed[k - 1].t + MIN_CUE_GAP) placed[k].t = placed[k - 1].t + MIN_CUE_GAP;
    }
    // Pushing cues apart can run them past the end; pull them back inside the section.
    for (let k = placed.length - 1; k >= 0; k--) {
      const cap = k === placed.length - 1 ? duration - MIN_CUE_GAP : placed[k + 1].t - MIN_CUE_GAP;
      if (placed[k].t > cap) placed[k].t = cap;
    }
    // A section too short for all its visuals keeps the ones that fit.
    while (placed.length && placed[0].t < 0) {
      const dropped = placed.shift()!;
      warnings.push(
        `Section ${i + 1}: too many visuals for its length, so the ${dropped.cue.kind} visual at "${dropped.cue.anchor}" is left out.`
      );
    }

    placed.forEach((p, k) => {
      const cueStart = start + Math.min(p.t, Math.max(0, duration - 0.2));
      const cueEnd = Math.min(end, k + 1 < placed.length ? start + placed[k + 1].t : end);
      const { avatar: nextPose, panel } = layoutGeometry(p.cue.layout, c, p.cue.id);
      setPose(cueStart, p.cue.kind === "presenter" ? PRESENTER_POSE : nextPose);
      if (p.cue.kind === "presenter") return;

      const states = [cueStart];
      const count = cueStates(p.cue, input.objectives);
      if (p.cue.kind === "check" && count === 2) {
        const a = at(p.cue.answerAnchor);
        const t = a ? start + a.t : cueStart + (cueEnd - cueStart) * 0.6;
        states.push(Math.min(cueEnd - 0.3, Math.max(cueStart + 0.6, t)));
      } else if (count > 1) {
        const bullets = cueBullets(p.cue, input.objectives);
        const span = cueEnd - cueStart;
        const step = Math.min(3, Math.max(0.4, (span - 1) / bullets.length));
        let prev = cueStart;
        bullets.forEach((b, n) => {
          const a = at(b.anchor);
          let t = a ? start + a.t : cueStart + 0.6 + n * step;
          // Reveals stay in order, never before the panel has arrived.
          t = Math.max(t, n === 0 ? cueStart + (p.cue.title ? 0.4 : 0) : prev + 0.4);
          t = Math.min(t, cueEnd - 0.2);
          states.push(t);
          prev = t;
        });
      }

      cues.push({
        id: p.cue.id,
        section: i,
        kind: p.cue.kind,
        layout: p.cue.layout,
        transition: p.cue.transition,
        start: round(cueStart),
        end: round(cueEnd),
        panel,
        rasterKey: cueKeyOf(p.cue),
        states: states.map(round),
        kenBurns: Boolean(p.cue.kenBurns),
        match: p.match,
      });
    });
    clock = end;
  });

  if (c.outro) {
    const key = keyFor("outro");
    if (key) cards.push({ role: "outro", start: round(clock), duration: OUTRO_S, rasterKey: key });
    clock += OUTRO_S;
  }

  const lowerKey = keyFor("lower");
  const first = sections[0];
  let lowerThird: TrainingTimeline["lowerThird"] = null;
  if (lowerKey && first) {
    const start = round(first.start + LOWER_THIRD_AT);
    // Leave before the presenter moves to another layout.
    const move = avatar.find((k) => k.t > start && k.ease === "linear");
    const end = round(
      Math.min(first.start + Math.min(first.duration - 0.2, LOWER_THIRD_AT + LOWER_THIRD_S), move ? move.t : Infinity)
    );
    // Name the presenter beside them, and not at all while they are in a corner or off screen.
    const p = sampleAvatar(avatar, start);
    if (end - start >= 1.5 && p.opacity > 0.5 && p.scale >= SIDE_SCALE) {
      const right = p.cx > 0.6;
      lowerThird = {
        start,
        end,
        rasterKey: lowerKey,
        rect: right ? { ...LOWER_THIRD_RECT, x: round(1 - LOWER_THIRD_RECT.x - LOWER_THIRD_RECT.w) } : LOWER_THIRD_RECT,
      };
    }
  }

  return {
    width,
    height,
    duration: round(clock),
    sections,
    cards,
    cues,
    avatar,
    captions: c.captions === "off" ? [] : captions,
    lowerThird,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Playback helpers
// ---------------------------------------------------------------------------

const easeInOutSine = (u: number) => -(Math.cos(Math.PI * u) - 1) / 2;

/** The presenter's pose at time t. */
export function sampleAvatar(frames: AvatarKeyframe[], t: number): AvatarPose {
  if (!frames.length || t <= frames[0].t) {
    const f = frames[0];
    return f ? { cx: f.cx, cy: f.cy, scale: f.scale, opacity: f.opacity } : PRESENTER_POSE;
  }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (t <= b.t) {
      const span = b.t - a.t;
      const u = span > 0 ? (t - a.t) / span : 1;
      const e = b.ease === "inOutSine" ? easeInOutSine(u) : u;
      return {
        cx: a.cx + (b.cx - a.cx) * e,
        cy: a.cy + (b.cy - a.cy) * e,
        scale: a.scale + (b.scale - a.scale) * e,
        opacity: a.opacity + (b.opacity - a.opacity) * e,
      };
    }
  }
  const l = frames[frames.length - 1];
  return { cx: l.cx, cy: l.cy, scale: l.scale, opacity: l.opacity };
}

/** Which build state of a cue shows at time t. */
export function stateAt(cue: Pick<TimelineCue, "states">, t: number): number {
  let s = 0;
  for (let i = 0; i < cue.states.length; i++) if (t >= cue.states[i]) s = i;
  return s;
}

const vttTime = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(ms % 1000, 3)}`;
};

export function toWebVtt(captions: TrainingTimeline["captions"]): string {
  return `WEBVTT\n\n${captions
    .map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}`)
    .join("\n\n")}\n`;
}

/**
 * The config scripts/training/render.py plays back. File locations are
 * supplied by the caller, so this stays pure and the check script can use it.
 */
export function renderConfig(
  tl: TrainingTimeline,
  opts: {
    output: string;
    background: string;
    palette: unknown;
    clip: (section: number) => string;
    raster: (key: string, state: number) => string;
    burnCaptions: boolean;
    logo?: string | null;
    fps?: number;
  }
) {
  return {
    output: opts.output,
    width: tl.width,
    height: tl.height,
    fps: opts.fps ?? 25,
    duration: tl.duration,
    background: opts.background,
    palette: opts.palette,
    timing: { cueIn: CUE_IN_S, cueOut: CUE_OUT_S, reveal: REVEAL_S },
    clips: tl.sections.map((s) => ({ src: opts.clip(s.index), start: s.start, duration: s.duration })),
    avatar: tl.avatar,
    cues: tl.cues
      .filter((q) => q.rasterKey && q.panel)
      .map((q) => ({
        start: q.start,
        end: q.end,
        transition: q.transition,
        panel: q.panel,
        kenBurns: q.kenBurns,
        states: q.states.map((at, k) => ({ at, src: opts.raster(q.rasterKey!, k) })),
      })),
    cards: tl.cards.map((k) => ({ start: k.start, duration: k.duration, src: opts.raster(k.rasterKey, 0) })),
    lowerThird: tl.lowerThird
      ? {
          start: tl.lowerThird.start,
          end: tl.lowerThird.end,
          rect: tl.lowerThird.rect,
          src: opts.raster(tl.lowerThird.rasterKey, 0),
        }
      : null,
    captions: opts.burnCaptions ? tl.captions : [],
    logo: opts.logo ?? null,
  };
}

export { compositionPalette };
