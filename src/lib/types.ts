import type { MotionOptions, MotionPlan } from "./motion";
import type { TrainingComposition, TrainingCue } from "./trainingvisuals";
import type { MusicChoice } from "./musicchoice";
import type { WatermarkChoice } from "./watermarkchoice";
import type { NarrationSettings } from "./narration";
import type { PodcastScript } from "./podcastscript";
import type { ScenePlan } from "./whiteboard";

/** Steering and music every spoken format carries. */
export type SpokenExtras = {
  /** Instructions and word replacements the script was written with. */
  narration?: NarrationSettings;
  /** The music bed to mix in on the next render; null for none. */
  musicChoice?: MusicChoice | null;
  /** Whether the last render actually had music mixed in. */
  music?: boolean;
};

/** The watermark every video format can carry. */
export type VideoExtras = {
  /** The watermark to stamp on the next render; null for none. */
  watermarkChoice?: WatermarkChoice | null;
  /** Whether the last render actually had a watermark stamped on it. */
  watermarked?: boolean;
};

export type ArtifactType =
  | "report"
  | "briefing"
  | "study_guide"
  | "faq"
  | "quiz"
  | "flashcards"
  | "mindmap"
  | "timeline"
  | "slides"
  | "infographic"
  | "video"
  | "motion"
  | "training"
  | "podcast";

/** Study aids can be tuned for depth and rigour at generation time. */
export type StudyDifficulty = "easy" | "medium" | "hard";
export type StudyLength = "short" | "standard" | "long";
export type StudyOptions = {
  difficulty?: StudyDifficulty;
  length?: StudyLength;
  /** Target running time for the audio overview. */
  audioLength?: string;
};

export type Citation = {
  n: number;
  sourceId: string;
  sourceTitle: string;
  part: number;
  snippet: string;
};

export type DocContent = { title: string; subtitle?: string; markdown: string };
export type FaqContent = { title: string; items: { q: string; a: string }[] };
export type QuizQuestion = {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
};
export type QuizContent = {
  title: string;
  questions: QuizQuestion[];
  difficulty?: StudyDifficulty;
};

export type Flashcard = {
  front: string;
  back: string;
  /** Optional nudge shown before the card is flipped. */
  hint?: string;
};
export type FlashcardsContent = {
  title: string;
  subtitle?: string;
  cards: Flashcard[];
  difficulty?: StudyDifficulty;
};

export type MindNode = { label: string; note?: string; children?: MindNode[] };
export type MindMapContent = { title: string; root: MindNode };

export type TimelineContent = {
  title: string;
  items: { date: string; title: string; text: string }[];
};

export type SlideTheme = "midnight" | "light" | "ocean" | "sunset";
export type SlideLayout = "title" | "agenda" | "section" | "bullets" | "closing" | "sources";
export type Slide = {
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  notes?: string;
};
export type SlidesContent = {
  title: string;
  subtitle?: string;
  theme: SlideTheme;
  slides: Slide[];
};

export type InfographicContent = {
  title: string;
  subtitle?: string;
  accent?: string;
  /** Visual style key from src/lib/infographic.ts; defaults to "classic". */
  style?: string;
  stats: { value: string; label: string; caption?: string }[];
  sections: { heading: string; icon?: string; bullets: string[] }[];
  takeaway?: string;
  /** Used by editorial and watercolor styles. */
  pullQuote?: string;
  /** Used by the corporate style. */
  nextSteps?: string[];
  /** Ordered stages, used by the process flow layout. */
  flow?: string[];
  /** Comparable figures on one scale, used by the data-driven layout. */
  chart?: { label: string; value: number; display?: string }[];
  /** Side-by-side comparison, used by the comparison layout. */
  compare?: {
    aLabel: string;
    bLabel: string;
    rows: { feature: string; a: string; b: string }[];
    verdict?: string;
  };
  /** Actionable items, used by the checklist layout. */
  checklist?: { title: string; detail: string }[];
  /** Thematic groups of visual concepts, used by the illustrated layout. */
  regions?: {
    heading: string;
    concepts: {
      takeaway: string;
      detail: string;
      metaphor: string;
      value?: string;
    }[];
  }[];
  /** Visual guide: the central concept everything else connects to. */
  hub?: { label: string; caption?: string };
  /** Visual guide: graded tiers, lightest to heaviest. */
  scale?: { tier: string; example?: string; figure?: string }[];
  /** Visual guide: 2-4 options compared across features. */
  matrix?: { columns: string[]; rows: { feature: string; values: string[] }[] };
  /** Dated events in order, used by the timeline layout. */
  milestones?: { date: string; title: string; detail: string }[];
  /** Ranked tiers, top first: the pyramid (narrow top) and funnel (wide top) layouts. */
  levels?: { label: string; detail: string; value?: string }[];
  /** Misconceptions and the corrections the sources give, used by the myth-vs-fact layout. */
  myths?: { myth: string; fact: string }[];
  /** Arguments for and against, used by the pros-and-cons layout. */
  pros?: string[];
  cons?: string[];
  /** Key terms and short definitions, used by the cheat-sheet layout. */
  terms?: { term: string; definition: string }[];
  /** Requested frame shape; also the size of the picture for image styles. */
  orientation?: InfographicOrientation;
  /** Requested amount of detail. */
  detail?: InfographicDetail;
  /**
   * Set when an image style could not be rendered and the brief was kept in
   * the HTML illustrated layout instead, so no generated content is lost.
   */
  imageFallback?: { from: string; reason: string };
  /** Set by the image styles: the rendered PNG served from /api/image/:id. */
  imageUrl?: string;
  imageModel?: string;
  imageSize?: string;
};

export type InfographicOrientation = "landscape" | "portrait" | "square";
export type InfographicDetail = "concise" | "standard" | "detailed";

export type PodcastSpeakerId = "a" | "b" | "c" | "d";
export type PodcastTurn = { speaker: PodcastSpeakerId; text: string; at: number };
export type PodcastSpeaker = {
  id: PodcastSpeakerId;
  name?: string;
  voice: string;
  role?: string;
};

export type PodcastContent = SpokenExtras & {
  title: string;
  description?: string;
  /**
   * "script" while the transcript awaits review, "narrating" while speech is
   * being synthesized, "done" once there is audio. Absent on older overviews,
   * which always have audio.
   */
  stage?: "script" | "narrating" | "done";
  /** The editable script. Older overviews rebuild it from `turns`. */
  script?: PodcastScript;
  turns: PodcastTurn[];
  audioUrl?: string;
  durationSec: number;
  voices: Partial<Record<PodcastSpeakerId, string>>;
  /** Speaker display names and roles used to write the episode. */
  speakers?: PodcastSpeaker[];
  settings?: { preset?: string; rate?: number; breath?: number };
  /** Older overviews stored the speed here, not in `settings`. */
  rate?: number;
  /** When the current narration started, while `stage` is "narrating". */
  narratingAt?: number;
  /** Requested running time, so the result can be compared with the target. */
  length?: string;
  targetMinutes?: number;
  /** Named sections with their start offset, for jumping around the audio. */
  chapters?: { title: string; at: number }[];
  /** Set when the script changed after the last narration. */
  editedSinceNarration?: boolean;
  /** Last narration problem, shown above the editor. */
  note?: string;
};

export type VideoContent = SpokenExtras & VideoExtras & {
  title: string;
  description?: string;
  scenes: {
    title: string;
    caption: string;
    narration: string;
    step?: number;
    /** Story beat of a motion explainer scene: problem, solution, how, benefits, cta. */
    beat?: string;
  }[];
  /** The full editable plan; absent on videos made before scripts were editable. */
  plan?: ScenePlan | MotionPlan;
  videoUrl?: string;
  bytes?: number;
  voice?: string;
  /** Motion explainers record the customization they were made with. */
  options?: MotionOptions;
  progress?: { stage: string; done: number; total: number; note?: string };
  /** Set when the script changed after the last render. */
  editedSinceRender?: boolean;
};

export type TrainingStage =
  /** Transcript written and waiting for review; nothing has been billed yet. */
  | "transcript"
  | "submitting"
  | "submitted"
  | "rendering"
  | "downloading"
  /** Composed videos: laying the visuals over the presenter clips. */
  | "composing"
  | "done"
  | "failed";

export type TrainingSection = {
  title: string;
  text: string;
  /** Visuals timed to phrases of `text`; composed videos only. */
  cues?: TrainingCue[];
  /** A gesture the presenter starts with ("none" for stillness); absent follows TrainingContent.gestureMode. */
  gesture?: string;
};

/** One section's presenter clip in a composed render. */
export type TrainingClip = {
  /** Content hash of the presenter, voice and SSML; names the cached file. */
  hash: string;
  status: "cached" | "pending" | "submitted" | "rendering" | "done" | "failed";
  synthesisId?: string;
  submittedAt?: number;
  durationSec?: number;
  /** Avatar seconds Azure billed for this clip. */
  billedSec?: number;
};

export type TrainingContent = SpokenExtras & VideoExtras & {
  title: string;
  description?: string;
  objectives: string[];
  sections: TrainingSection[];
  /** Key into AVATAR_PRESETS (src/lib/avatars.ts). */
  presenter: string;
  /** Speaker name from PINNED_VOICES, or a full voice name from /api/voices. */
  voice: string;
  /** express-as style the chosen voice supports; absent for its default delivery. */
  voiceStyle?: string;
  /** "auto" adds varied gestures through the speech; absent or "off" leaves only the ones chosen per section. */
  gestureMode?: "auto" | "off";
  /** #RRGGBB background behind the presenter. */
  background: string;
  length?: string;
  targetMinutes?: number;
  /** Optional USD per minute of avatar output, for the on-screen estimate. */
  pricePerMinute?: number;
  progress: {
    stage: TrainingStage;
    note?: string;
    synthesisId?: string;
    submittedAt?: number;
    /** Composed renders: one presenter clip per section, in order. */
    clips?: TrainingClip[];
    /** While composing: how far the video has been drawn, as a whole percent. */
    renderPct?: number;
  };
  /** Absent on videos made before composition: they render presenter only. */
  composition?: TrainingComposition;
  /** WebVTT captions of the last composed render. */
  captionsUrl?: string;
  videoUrl?: string;
  durationSec?: number;
  bytes?: number;
  /** Avatar seconds Azure reported billing for the last render. */
  billedSeconds?: number;
  renderedAt?: number;
  /** Set when the transcript changed after the last render. */
  editedSinceRender?: boolean;
};

export type ArtifactContent =
  | DocContent
  | TrainingContent
  | FaqContent
  | QuizContent
  | FlashcardsContent
  | MindMapContent
  | TimelineContent
  | SlidesContent
  | InfographicContent
  | VideoContent
  | PodcastContent;

export type Artifact = {
  id: string;
  notebookId: string;
  type: ArtifactType;
  title: string;
  content: ArtifactContent & { citations?: Citation[] };
  createdAt: number;
};

/**
 * What a listing needs to know about an artifact.
 *
 * Bodies are fetched when one is opened rather than shipped with the notebook:
 * they are the bulk of that response and grow with every artifact ever made,
 * while the list itself only ever shows an icon, a title and a date.
 */
export type ArtifactSummary = {
  id: string;
  type: ArtifactType;
  title: string;
  createdAt: number;
};

export type Source = {
  id: string;
  notebookId: string;
  title: string;
  kind: string;
  url: string | null;
  chars: number;
  summary: string | null;
  createdAt: number;
};

export type Notebook = {
  id: string;
  title: string;
  emoji: string;
  createdAt: number;
  sourceCount?: number;
  /** Saved narration defaults for the spoken Studio formats (detail view only). */
  narration?: NarrationSettings;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  createdAt: number;
};

/** One conversation thread; a notebook can hold any number of them. */
export type ChatSession = {
  id: string;
  notebookId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
};

/**
 * A note is the user's own writing, or model output they chose to keep: a saved
 * chat answer or the result of a transformation. `kind` records which, so the
 * list can distinguish what was written from what was generated.
 */
export type Note = {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  kind: "human" | "ai";
  sourceId: string | null;
  citations?: Citation[];
  createdAt: number;
  updatedAt: number;
};

/** A reusable prompt applied to one source at a time. */
export type Transformation = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  builtin: boolean;
};
