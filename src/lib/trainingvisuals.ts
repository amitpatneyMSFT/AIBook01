/**
 * Composed training videos: the visual cues laid over (or beside) the avatar
 * presenter, and the video-level design settings they are rendered with.
 *
 * A cue is pinned to a phrase of the transcript, not to a time. Times only
 * exist once the speech has been measured (src/lib/trainingtimeline.ts), and
 * an anchor survives edits to the rest of the script where a timestamp would
 * silently drift.
 *
 * Nothing here touches the server, so the editor, the planner rules and the
 * normalizers share one implementation and can be unit-tested.
 */
import { MOTION_PALETTES, type MotionPalette } from "./motion";
import { caseVocabulary, casedCue } from "./slidecase";

export const CUE_KINDS = [
  "title",
  "objectives",
  "bullets",
  "stat",
  "quote",
  "check",
  "image",
  "screenshot",
  "infographic",
  "presenter",
] as const;
export type CueKind = (typeof CUE_KINDS)[number];

export const CUE_KIND_LABELS: Record<CueKind, string> = {
  title: "Title card",
  objectives: "Learning objectives",
  bullets: "Bullet points",
  stat: "Key number",
  quote: "Quote",
  check: "Knowledge check",
  image: "AI image",
  screenshot: "Screenshot or picture",
  infographic: "Infographic",
  presenter: "Back to presenter",
};

/** Text visuals that show a picture beside their words when they have one. */
export const TEXT_PICTURE_KINDS: readonly CueKind[] = ["title", "objectives", "bullets", "stat", "quote", "check"];

export const cueTakesPicture = (cue: Pick<TrainingCue, "kind">) =>
  cue.kind === "image" || TEXT_PICTURE_KINDS.includes(cue.kind);

/** A visual still without its picture that says how to find or draw one. */
export const cueNeedsPicture = (cue: TrainingCue) =>
  cueTakesPicture(cue) && !cue.imageId && Boolean(cue.imageQuery || cue.imagePrompt);

/** Where the presenter sits while a cue is on screen. */
export const LAYOUTS = ["presenter", "side-left", "side-right", "pip", "full"] as const;
export type TrainingLayout = (typeof LAYOUTS)[number];

export const LAYOUT_LABELS: Record<TrainingLayout, string> = {
  presenter: "Presenter only",
  "side-left": "Presenter left, visual right",
  "side-right": "Presenter right, visual left",
  pip: "Visual with presenter in a corner",
  full: "Full-screen visual, voice only",
};

export const CUE_TRANSITIONS = ["cut", "fade", "slide", "wipe", "zoom"] as const;
export type CueTransition = (typeof CUE_TRANSITIONS)[number];

export const TRANSITION_LABELS: Record<CueTransition, string> = {
  cut: "Cut",
  fade: "Fade",
  slide: "Slide in",
  wipe: "Wipe",
  zoom: "Zoom in",
};

export const PIP_CORNERS = ["bottom-right", "bottom-left", "top-right", "top-left"] as const;
export type PipCorner = (typeof PIP_CORNERS)[number];

/** Screen location setting: a fixed corner, or "random" (picked per visual). */
export const PIP_CORNER_SETTINGS = [...PIP_CORNERS, "random"] as const;
export type PipCornerSetting = (typeof PIP_CORNER_SETTINGS)[number];

export const PIP_SIZES = ["small", "medium", "large"] as const;
export type PipSize = (typeof PIP_SIZES)[number];
export const PIP_SIZE_SETTINGS = [...PIP_SIZES, "random"] as const;
export type PipSizeSetting = (typeof PIP_SIZE_SETTINGS)[number];

/** Share of the frame the corner presenter occupies. */
export const PIP_SCALES: Record<PipSize, number> = { small: 0.3, medium: 0.42, large: 0.56 };

/**
 * The corner and size one visual uses. "random" settings are chosen from the
 * cue id, so the preview, the plan and the render all agree.
 */
export function resolvePip(
  c: { pipCorner: PipCornerSetting; pipSize?: PipSizeSetting },
  seed = ""
): { corner: PipCorner; size: PipSize } {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const corner = c.pipCorner === "random" ? PIP_CORNERS[h % PIP_CORNERS.length] : c.pipCorner;
  const sizeSetting = c.pipSize ?? "medium";
  const size = sizeSetting === "random" ? PIP_SIZES[((h >>> 8) + 1) % PIP_SIZES.length] : sizeSetting;
  return { corner, size };
}

export const CAPTION_MODES = ["burned", "sidecar", "off"] as const;
export type CaptionMode = (typeof CAPTION_MODES)[number];

export const CAPTION_LABELS: Record<CaptionMode, string> = {
  burned: "Burned into the video",
  sidecar: "Separate WebVTT file",
  off: "No captions",
};

export const TRAINING_RESOLUTIONS = {
  "720p": { label: "720p (faster)", width: 1280, height: 720 },
  "1080p": { label: "1080p (sharper, slower to compose)", width: 1920, height: 1080 },
} as const;
export type TrainingResolution = keyof typeof TRAINING_RESOLUTIONS;

export type TrainingBullet = {
  text: string;
  /** Phrase that reveals this bullet; absent bullets are spaced evenly. */
  anchor?: string;
};

export type TrainingCue = {
  id: string;
  kind: CueKind;
  /** Words from the section's script; the cue appears as they are spoken. */
  anchor: string;
  /** Seconds to shift the cue from its anchor, for fine timing. */
  offsetSec?: number;
  layout: TrainingLayout;
  transition: CueTransition;
  title?: string;
  subtitle?: string;
  bullets?: TrainingBullet[];
  stat?: { value: string; label: string };
  quote?: { text: string; attribution?: string };
  question?: string;
  answer?: string;
  /** Phrase at which the answer of a knowledge check is revealed. */
  answerAnchor?: string;
  infographicId?: string;
  /** Picture served from /api/image/:id — uploaded, captured or generated. */
  imageId?: string;
  imagePrompt?: string;
  /** Microsoft Learn search that finds a real screenshot for this visual. */
  imageQuery?: string;
  /** Where a found picture came from, shown on the slide ("Microsoft Learn"). */
  imageCredit?: string;
  /** The found picture's original address, so a video does not use it twice. */
  imageSource?: string;
  caption?: string;
  /** Slow push-in on pictures. */
  kenBurns?: boolean;
};

export type TrainingAnimation = {
  transitions: boolean;
  pictures: boolean;
  bullets: boolean;
  layout: boolean;
};

export const ANIMATION_PRESETS = {
  none: { label: "None", transitions: false, pictures: false, bullets: false, layout: false },
  light: { label: "Light (transitions only)", transitions: true, pictures: false, bullets: false, layout: false },
  full: { label: "Full", transitions: true, pictures: true, bullets: true, layout: true },
} as const;

export function normalizeAnimation(raw: unknown): TrainingAnimation {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const { transitions, pictures, bullets, layout } = ANIMATION_PRESETS.full;
  return {
    transitions: typeof o.transitions === "boolean" ? o.transitions : transitions,
    pictures: typeof o.pictures === "boolean" ? o.pictures : pictures,
    bullets: typeof o.bullets === "boolean" ? o.bullets : bullets,
    layout: typeof o.layout === "boolean" ? o.layout : layout,
  };
}

export type TrainingComposition = {
  /** "presenter" is the original single avatar video; "composed" adds visuals. */
  mode: "presenter" | "composed";
  palette: keyof typeof MOTION_PALETTES;
  /** Layout used by cues that do not choose one. */
  defaultLayout: Exclude<TrainingLayout, "presenter">;
  transition: CueTransition;
  animation: TrainingAnimation;
  /** A short title card between sections, which also hides the cut between clips. */
  sectionCards: boolean;
  intro: boolean;
  outro: boolean;
  lowerThird: { enabled: boolean; name: string; role: string };
  captions: CaptionMode;
  resolution: TrainingResolution;
  pipCorner: PipCornerSetting;
  /** Absent on videos made before this setting: medium. */
  pipSize: PipSizeSetting;
  /** Small logo in a corner of every frame. */
  logoId?: string;
};

export const DEFAULT_COMPOSITION: TrainingComposition = {
  mode: "composed",
  palette: "slate",
  defaultLayout: "side-left",
  transition: "slide",
  animation: normalizeAnimation(undefined),
  sectionCards: true,
  intro: true,
  outro: true,
  lowerThird: { enabled: true, name: "", role: "Your trainer" },
  captions: "burned",
  resolution: "720p",
  pipCorner: "bottom-right",
  pipSize: "medium",
};

/** What a training video made before composition existed renders as. */
export const PRESENTER_ONLY: TrainingComposition = { ...DEFAULT_COMPOSITION, mode: "presenter" };

export const MAX_CUES_PER_SECTION = 12;
export const MAX_BULLETS = 6;
const MAX_TEXT = 220;
const MAX_TITLE = 90;

const str = (v: unknown, max = MAX_TEXT) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback;

const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(v);

export function compositionPalette(c: Pick<TrainingComposition, "palette">): MotionPalette {
  return (MOTION_PALETTES[c.palette] ?? MOTION_PALETTES.slate).colors;
}

export function normalizeComposition(raw: unknown): TrainingComposition {
  if (!raw || typeof raw !== "object") return { ...PRESENTER_ONLY };
  const o = raw as Record<string, unknown>;
  const d = DEFAULT_COMPOSITION;
  const lt = (o.lowerThird ?? {}) as Record<string, unknown>;
  const layout = pick(o.defaultLayout, LAYOUTS, d.defaultLayout);
  return {
    mode: o.mode === "presenter" ? "presenter" : "composed",
    palette: pick(o.palette, Object.keys(MOTION_PALETTES) as (keyof typeof MOTION_PALETTES)[], d.palette),
    defaultLayout: layout === "presenter" ? d.defaultLayout : layout,
    transition: pick(o.transition, CUE_TRANSITIONS, d.transition),
    animation: normalizeAnimation(o.animation),
    sectionCards: typeof o.sectionCards === "boolean" ? o.sectionCards : d.sectionCards,
    intro: typeof o.intro === "boolean" ? o.intro : d.intro,
    outro: typeof o.outro === "boolean" ? o.outro : d.outro,
    lowerThird: {
      enabled: typeof lt.enabled === "boolean" ? lt.enabled : d.lowerThird.enabled,
      name: str(lt.name, 60),
      role: typeof lt.role === "string" ? str(lt.role, 60) : d.lowerThird.role,
    },
    captions: pick(o.captions, CAPTION_MODES, d.captions),
    resolution: pick(
      o.resolution,
      Object.keys(TRAINING_RESOLUTIONS) as TrainingResolution[],
      d.resolution
    ),
    pipCorner: pick(o.pipCorner, PIP_CORNER_SETTINGS, d.pipCorner),
    pipSize: pick(o.pipSize, PIP_SIZE_SETTINGS, d.pipSize),
    ...(isId(o.logoId) ? { logoId: o.logoId } : {}),
  };
}

/** Short random id; collisions only matter within one video's cues. */
export function newCueId(): string {
  return Math.random().toString(36).slice(2, 10).padEnd(8, "0");
}

/**
 * One cue from untrusted input. `fallbackLayout` fills in a missing layout;
 * kinds that have nothing to show are dropped (null).
 */
export function normalizeCue(
  raw: unknown,
  fallback: Pick<TrainingComposition, "defaultLayout" | "transition"> = DEFAULT_COMPOSITION,
  /** Keep cues the user is still filling in; the planner's are dropped instead. */
  keepEmpty = false
): TrainingCue | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = pick(o.kind, CUE_KINDS, "bullets");
  const anchor = str(o.anchor, 160);
  const id = typeof o.id === "string" && /^[a-z0-9]{4,16}$/.test(o.id) ? o.id : newCueId();
  let layout = pick(o.layout, LAYOUTS, fallback.defaultLayout);
  if (kind === "presenter") layout = "presenter";
  else if (layout === "presenter") layout = fallback.defaultLayout;

  const cue: TrainingCue = {
    id,
    kind,
    anchor,
    layout,
    transition: pick(o.transition, CUE_TRANSITIONS, fallback.transition),
  };
  const offset = Number(o.offsetSec);
  if (Number.isFinite(offset) && offset !== 0) cue.offsetSec = Math.max(-10, Math.min(10, Math.round(offset * 10) / 10));

  const title = str(o.title, MAX_TITLE);
  if (title) cue.title = title;
  const subtitle = str(o.subtitle, 160);
  if (subtitle) cue.subtitle = subtitle;
  const caption = str(o.caption, 160);
  if (caption) cue.caption = caption;

  const bullets = (Array.isArray(o.bullets) ? o.bullets : [])
    .map((b): TrainingBullet | null => {
      if (typeof b === "string") return str(b) ? { text: str(b) } : null;
      const bo = (b ?? {}) as Record<string, unknown>;
      const text = str(bo.text);
      if (!text) return null;
      const a = str(bo.anchor, 160);
      return a ? { text, anchor: a } : { text };
    })
    .filter((b): b is TrainingBullet => Boolean(b))
    .slice(0, MAX_BULLETS);
  if (bullets.length) cue.bullets = bullets;

  const stat = (o.stat ?? null) as Record<string, unknown> | null;
  if (stat && str(stat.value, 24)) cue.stat = { value: str(stat.value, 24), label: str(stat.label, 120) };
  const quote = (o.quote ?? null) as Record<string, unknown> | null;
  if (quote && str(quote.text, 300)) {
    cue.quote = { text: str(quote.text, 300), ...(str(quote.attribution, 100) ? { attribution: str(quote.attribution, 100) } : {}) };
  }
  const question = str(o.question, 240);
  if (question) cue.question = question;
  const answer = str(o.answer, 300);
  if (answer) cue.answer = answer;
  const answerAnchor = str(o.answerAnchor, 160);
  if (answerAnchor) cue.answerAnchor = answerAnchor;
  if (isId(o.infographicId)) cue.infographicId = o.infographicId;
  if (isId(o.imageId)) cue.imageId = o.imageId;
  const prompt = str(o.imagePrompt, 600);
  if (prompt) cue.imagePrompt = prompt;
  const query = str(o.imageQuery, 120);
  if (query) cue.imageQuery = query;
  if (cue.imageId) {
    const credit = str(o.imageCredit, 60);
    if (credit) cue.imageCredit = credit;
    const source = str(o.imageSource, 400);
    if (/^https:\/\/[^\s"'<>]+$/i.test(source)) cue.imageSource = source;
  }
  if (kind === "image" || kind === "screenshot") cue.kenBurns = o.kenBurns !== false;
  if (keepEmpty) return cue;

  // Kinds that would put an empty panel on screen.
  switch (kind) {
    case "bullets":
      if (!cue.bullets?.length && !cue.title) return null;
      break;
    case "stat":
      if (!cue.stat) return null;
      break;
    case "quote":
      if (!cue.quote) return null;
      break;
    case "check":
      if (!cue.question) return null;
      break;
    case "title":
      if (!cue.title) return null;
      break;
    case "image":
      if (!cue.imageId && !cue.imagePrompt && !cue.imageQuery) return null;
      break;
  }
  return cue;
}

export function normalizeCues(
  raw: unknown,
  fallback: Pick<TrainingComposition, "defaultLayout" | "transition"> = DEFAULT_COMPOSITION,
  keepEmpty = false
): TrainingCue[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : [])
    .map((c) => normalizeCue(c, fallback, keepEmpty))
    .filter((c): c is TrainingCue => {
      if (!c) return false;
      if (seen.has(c.id)) c.id = newCueId();
      seen.add(c.id);
      return true;
    })
    .slice(0, MAX_CUES_PER_SECTION);
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

export type Word = { text: string; norm: string; start: number; end: number };

/** Words of a text with their character spans, normalized for matching. */
export function tokenize(text: string): Word[] {
  const out: Word[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({
      text: m[0],
      norm: m[0].toLowerCase().replace(/[’]/g, "'").replace(/[-']/g, ""),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export type AnchorMatch = { word: number; exact: boolean };

/**
 * Where an anchor phrase starts, as a word index into `text`. Exact matching
 * ignores case and punctuation; failing that, the best window with at least
 * 60% of the anchor's words in place is accepted as approximate, so a small
 * edit to the script does not orphan the visual.
 */
export function findAnchor(text: string, anchor: string, words = tokenize(text)): AnchorMatch | null {
  const a = tokenize(anchor).map((w) => w.norm);
  if (!a.length || !words.length) return null;
  const n = a.length;
  for (let i = 0; i + n <= words.length; i++) {
    let hit = true;
    for (let j = 0; j < n; j++) {
      if (words[i + j].norm !== a[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return { word: i, exact: true };
  }
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < words.length; i++) {
    let score = 0;
    for (let j = 0; j < n && i + j < words.length; j++) if (words[i + j].norm === a[j]) score++;
    // Starting on a matching word keeps the cue from landing a word early.
    if (score > bestScore && words[i].norm === a[0]) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) {
    for (let i = 0; i < words.length; i++) {
      let score = 0;
      for (let j = 0; j < n && i + j < words.length; j++) if (words[i + j].norm === a[j]) score++;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best >= 0 && bestScore / n >= 0.6 ? { word: best, exact: false } : null;
}

/** A few words starting at a word index, for "add a visual here" from a selection. */
export function anchorAt(text: string, charOffset: number, length = 5): string {
  const words = tokenize(text);
  const i = words.findIndex((w) => w.end > charOffset);
  if (i < 0) return "";
  return text.slice(words[i].start, words[Math.min(words.length, i + length) - 1].end);
}

// ---------------------------------------------------------------------------
// Hashing (client-safe)
// ---------------------------------------------------------------------------

/** 64-bit FNV-1a as 16 hex characters. Identity, not security. */
export function hashText(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c ^ (i & 0xff), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export type PlannerInfographic = { id: string; title: string };

export function TRAINING_VISUALS_INSTRUCTION(opts: {
  images: boolean;
  infographics: PlannerInfographic[];
  presenter?: Pick<TrainingComposition, "pipCorner" | "pipSize">;
}): string {
  const where = opts.presenter?.pipCorner ?? DEFAULT_COMPOSITION.pipCorner;
  const howBig = opts.presenter?.pipSize ?? DEFAULT_COMPOSITION.pipSize;
  const pipRule =
    (where === "random"
      ? "the presenter moves between corners from visual to visual"
      : `the presenter sits in the ${where.replace("-", " ")} corner`) +
    (howBig === "random" ? " at varying sizes" : ` at ${howBig} size`);
  const kinds = [
    `"title" — section title card: title, optional subtitle`,
    `"objectives" — the learning objectives as a list: bullets`,
    `"bullets" — 2-5 short points revealed one at a time: title, bullets`,
    `"stat" — one striking number from the script: stat {value, label}, optional title`,
    `"quote" — a memorable line or attributed quotation: quote {text, attribution}`,
    `"check" — a knowledge-check question: question, answer, answerAnchor`,
    ...(opts.images
      ? [`"image" — an illustrative picture: imagePrompt (describe a clean, text-free illustration), imageQuery, caption`]
      : []),
    ...(opts.infographics.length
      ? [`"infographic" — show one of the notebook's infographics listed below: infographicId, title`]
      : []),
    `"presenter" — return to the presenter alone, with no visual`,
  ];
  return `You are a senior instructional designer and video editor. A lip-synced
presenter avatar delivers the training script below. Plan the visuals that
appear beside or instead of the presenter, each timed to the exact words the
presenter is saying when it should appear.

Respond with a single JSON object only. No markdown fences, no commentary.
Schema:
{
  "sections": [{
    "section": number,      // 1-based section number from the script
    "cues": [{
      "kind": string,       // one of the kinds below
      "anchor": string,     // 3-8 consecutive words copied EXACTLY from this section's script
      "layout": "side-left" | "side-right" | "pip" | "full",
      "title": string,
      "subtitle": string,
      "bullets": [{ "text": string, "anchor": string }],
      "stat": { "value": string, "label": string },
      "quote": { "text": string, "attribution": string },
      "question": string, "answer": string, "answerAnchor": string,
      "imageQuery": string, ${opts.images ? `"imagePrompt": string, ` : ""}"infographicId": string, "caption": string
    }]
  }]
}
Include only the fields a kind uses.

KINDS
${kinds.map((k) => `- ${k}`).join("\n")}

PICTURES
Every "title", "objectives", "bullets", "stat", "quote" and "check" visual is
shown beside a picture of the idea it teaches, so give each of them:
- "imageQuery": when the idea concerns a Microsoft product, service, portal or
  admin center, a 3-8 word Microsoft Learn search that would find a
  documentation page with a screenshot of exactly that (for example "create
  agent Copilot Studio portal"). Otherwise "".${
    opts.images
      ? `
- "imagePrompt": one sentence describing a clean, text-free illustration of
  the idea, used when no screenshot is found. Concrete subjects, no words,
  letters or logos in the picture.`
      : ""
  }

LAYOUTS
- "side-left": presenter on the left, visual on the right. The default for teaching.
- "side-right": presenter on the right, visual on the left. Alternate with side-left for variety.
- "pip": the visual fills the frame, presenter small in a corner (${pipRule}; keep key content away from that spot). For dense visuals and infographics.
- "full": visual only, the presenter's voice continues. Sparingly, for a big moment.

TIMING
- The anchor is where the visual appears: the first words of the sentence that
  introduces the idea, never words that come after the idea has been explained.
- Each bullet's anchor is where the presenter starts talking about that point,
  in the order spoken. A knowledge check's answerAnchor is where the presenter
  starts giving the answer.
- About one visual every 15-40 seconds of speech (roughly every 40-100 words).
  Leave the presenter alone for the opening greeting and the closing line.
- Anchors must be copied character for character from the same section and
  appear in the order the cues are listed.

CONTENT
- Opening section: a "title" card for the session, then "objectives" anchored
  where the presenter starts stating them.
- Teaching sections: "bullets", "stat", "quote"${opts.images ? `, "image"` : ""}${
    opts.infographics.length ? `, "infographic"` : ""
  } — choose what best shows the idea. Prefer a "stat" whenever a number is spoken.
- Recap: "bullets" with one bullet per point, each anchored where it is said.
- Knowledge check: one "check" per question.
- Every word on screen must come from the script. Never add facts, numbers or
  names the presenter does not say. Bullets are 2-7 words, titles 2-6 words.
- Capitalize on-screen text as a professionally edited slide would, even when
  the words come from mid-sentence: sentence case, so titles, bullets, labels,
  captions, questions and answers start with a capital letter, and product
  names, proper nouns and acronyms are written exactly as the script writes
  them ("Copilot Studio", "Azure", "AI"). Never write on-screen text in all
  lowercase. Anchors are still copied exactly.
- US English. No citation markers, emoji or markdown.${
    opts.infographics.length
      ? `\n\nNOTEBOOK INFOGRAPHICS (use the id exactly)\n${opts.infographics
          .map((g) => `- ${g.id}: ${g.title}`)
          .join("\n")}`
      : ""
  }`;
}

/**
 * The planner's reply, made safe: cues whose anchor is nowhere in their
 * section are dropped, bullet anchors that do not match are cleared, kinds the
 * notebook cannot supply are converted or dropped, and cues are put in spoken
 * order.
 */
export function normalizeVisualPlan(
  raw: unknown,
  sections: { text: string }[],
  opts: {
    composition?: Pick<TrainingComposition, "defaultLayout" | "transition">;
    images: boolean;
    infographicIds: string[];
  }
): TrainingCue[][] {
  const out: TrainingCue[][] = sections.map(() => []);
  const list = (raw && typeof raw === "object" ? (raw as { sections?: unknown }).sections : null) ?? [];
  if (!Array.isArray(list)) return out;
  const vocab = caseVocabulary(sections.map((s) => s.text));
  list.forEach((entry, pos) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const n = Number(e.section);
    const index = Number.isInteger(n) && n >= 1 && n <= sections.length ? n - 1 : pos;
    if (index >= sections.length) return;
    const text = sections[index].text;
    const words = tokenize(text);
    const placed: { cue: TrainingCue; at: number }[] = [];
    for (const rc of Array.isArray(e.cues) ? e.cues : []) {
      const r = { ...((rc ?? {}) as Record<string, unknown>) };
      if (r.kind === "image" && !opts.images) {
        // No image model: keep the moment as a quote card of the caption.
        if (typeof r.caption === "string" && r.caption.trim()) {
          r.kind = "quote";
          r.quote = { text: r.caption };
        } else continue;
      }
      if (r.kind === "infographic" && !opts.infographicIds.includes(String(r.infographicId))) continue;
      if (r.kind === "screenshot") continue;
      // Pictures are found or drawn later; the model cannot name one.
      delete r.imageId;
      delete r.imageCredit;
      delete r.imageSource;
      if (!opts.images) delete r.imagePrompt;
      const normalized = normalizeCue(r, opts.composition);
      if (!normalized) continue;
      const cue = casedCue(normalized, vocab);
      if (!cueTakesPicture(cue)) {
        delete cue.imageQuery;
        if (cue.kind !== "image") delete cue.imagePrompt;
      }
      const m = findAnchor(text, cue.anchor, words);
      if (!m) continue;
      if (cue.bullets) {
        cue.bullets = cue.bullets.map((b) =>
          b.anchor && findAnchor(text, b.anchor, words) ? b : { text: b.text }
        );
      }
      if (cue.answerAnchor && !findAnchor(text, cue.answerAnchor, words)) delete cue.answerAnchor;
      if (placed.some((p) => p.at === m.word)) continue;
      placed.push({ cue, at: m.word });
    }
    placed.sort((a, b) => a.at - b.at);
    out[index] = placed.map((p) => p.cue).slice(0, MAX_CUES_PER_SECTION);
  });
  return out;
}
