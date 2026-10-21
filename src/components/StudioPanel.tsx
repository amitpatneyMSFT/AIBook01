"use client";

import { useEffect, useRef, useState } from "react";
import MotionCustomize, {
  DEFAULT_MOTION_FORM,
  motionRequest,
  type MotionForm,
} from "@/components/MotionCustomize";
import MusicPicker from "@/components/MusicPicker";
import WatermarkPicker from "@/components/WatermarkPicker";
import NarrationOptions from "@/components/NarrationOptions";
import StudioCard from "@/components/StudioCard";
import VoicePicker from "@/components/VoicePicker";
import PresenterGallery from "@/components/PresenterGallery";
import LivePresenterModal from "@/components/LivePresenterModal";
import { voiceNickname } from "@/lib/voicecatalog";
import { STUDIO, STUDIO_SECTIONS, studioIcon, studioLabel } from "@/lib/studio";
import { DEFAULT_SLIDE_THEME, SLIDE_THEMES } from "@/lib/slides";
import { EMPTY_NARRATION, type NarrationSettings } from "@/lib/narration";
import type { MusicChoice } from "@/lib/musicchoice";
import type { WatermarkChoice } from "@/lib/watermarkchoice";
import {
  MAX_CUSTOM_SCENES,
  MIN_CUSTOM_SCENES,
  MOTION_LENGTHS,
  MOTION_PALETTES,
  MOTION_SECONDS_PER_SCENE,
  MOTION_SCENE_COUNT,
  motionSceneCount,
  type MotionLength,
} from "@/lib/motion";
import {
  MAX_WHITEBOARD_SCENES,
  MIN_WHITEBOARD_SCENES,
  WHITEBOARD_LENGTHS,
  WHITEBOARD_SECONDS_PER_SCENE,
  clampWhiteboardScenes,
  type WhiteboardLength,
  type WhiteboardPreset,
} from "@/lib/whiteboard";
import SceneLengthRow from "@/components/SceneLengthRow";
import { DEFAULT_COMPOSITION } from "@/lib/trainingvisuals";
import { readJSONReply } from "@/lib/jsonreply";
import {
  DEFAULT_STYLE,
  DETAIL_LEVELS,
  INFOGRAPHIC_STYLES,
  MAX_INFOGRAPHIC_INSTRUCTIONS,
  ORIENTATIONS,
  STYLE_META,
  STYLE_ORDER,
  isImageStyle,
  type InfographicStyle,
} from "@/lib/infographic";
import InfographicGallery, {
  ScaledExample,
} from "@/components/InfographicGallery";
import type { StyleSuggestion } from "@/lib/styleSuggest";
import {
  VOICE_PRESETS,
  MULTITALKER_SPEAKERS,
  RATE_CHOICES,
  AUDIO_LENGTHS,
  PINNED_VOICES,
  SPEAKER_IDS,
  canPin,
  type AudioLength,
  type SpeakerId,
} from "@/lib/voices";
import type {
  ArtifactSummary,
  ArtifactType,
  InfographicDetail,
  InfographicOrientation,
  SlideTheme,
  StudyDifficulty,
  StudyLength,
} from "@/lib/types";
import {
  AVATAR_PRESETS,
  BACKGROUNDS,
  DEFAULT_BACKGROUND,
  DEFAULT_PRESENTER,
  PRESENTER_ENTRIES,
  avatarPicture,
} from "@/lib/avatars";

/** Speakers that can be pinned, listed when a chosen one cannot be. */
const PINNABLE = Object.keys(PINNED_VOICES);

/** The formats that are spoken aloud and so take instructions and music. */
const SPOKEN = ["podcast", "video", "motion", "training"] as const;
type SpokenType = (typeof SPOKEN)[number];
/** The spoken formats that render a video and so can carry a watermark. */
type VideoType = Exclude<SpokenType, "podcast">;
const spokenRecord = <T,>(v: T): Record<SpokenType, T> => ({
  podcast: v,
  video: v,
  motion: v,
  training: v,
});

/** How the dialogue is rendered: voice family plus pause shaping. */
type Delivery = "natural" | "even" | "pinned";
type SpeakerConfig = {
  id: SpeakerId;
  voice: string;
  name: string;
  role: string;
};
type EpisodeProfile = {
  key: string;
  label: string;
  speakers: Omit<SpeakerConfig, "id" | "voice">[];
};

const EPISODE_PROFILES: EpisodeProfile[] = [
  {
    key: "deep-dive",
    label: "Deep dive (2 hosts)",
    speakers: [
      {
        name: "",
        role: "curious host who drives the conversation and asks questions",
      },
      { name: "", role: "analyst who explains the details and implications" },
    ],
  },
  {
    key: "solo",
    label: "Solo explainer (1)",
    speakers: [
      {
        name: "Narrator",
        role: "clear, curious narrator who explains the material directly",
      },
    ],
  },
  {
    key: "expert-panel",
    label: "Expert panel (3: host + two experts)",
    speakers: [
      {
        name: "Host",
        role: "moderator who frames the questions and keeps the pace",
      },
      {
        name: "Technical expert",
        role: "technical expert who explains mechanisms and tradeoffs",
      },
      {
        name: "Policy expert",
        role: "domain expert who explains consequences and caveats",
      },
    ],
  },
  {
    key: "debate",
    label: "Debate (4: moderator + 2 sides + fact-checker)",
    speakers: [
      {
        name: "Moderator",
        role: "moderator who keeps the discussion grounded",
      },
      {
        name: "Advocate",
        role: "optimistic advocate who argues for the strongest upside",
      },
      {
        name: "Skeptic",
        role: "skeptical challenger who tests assumptions and risks",
      },
      {
        name: "Fact-checker",
        role: "fact-checker who resolves claims against the sources",
      },
    ],
  },
];

const profileSpeakers = (key: string): SpeakerConfig[] => {
  const profile =
    EPISODE_PROFILES.find((p) => p.key === key) ?? EPISODE_PROFILES[0]!;
  return profile.speakers.map((s, i) => {
    const id = SPEAKER_IDS[i] ?? "a";
    return {
      id,
      voice: VOICE_PRESETS.conversational[id],
      ...s,
    };
  });
};

export default function StudioPanel({
  notebookId,
  hasSources,
  selectedIds,
  artifacts,
  onOpen,
  openingId,
  onRemove,
  onChanged,
  narrationDefaults,
  onSaveNarration,
  onDiscuss,
  onShowSources,
}: {
  notebookId: string;
  hasSources: boolean;
  selectedIds: string[];
  artifacts: ArtifactSummary[];
  /** Freshly generated artifacts arrive whole; list entries are fetched first. */
  onOpen: (a: ArtifactSummary) => void;
  openingId: string | null;
  /** Delete with an undo window; the panel only asks. */
  onRemove: (a: ArtifactSummary) => void;
  onChanged: () => Promise<void> | void;
  /** The notebook's saved narration instructions, pre-filled on each spoken card. */
  narrationDefaults?: NarrationSettings;
  onSaveNarration?: (n: NarrationSettings) => Promise<NarrationSettings>;
  /** Open a live spoken discussion, starting from the focus box. */
  onDiscuss?: (focus: string) => void;
  /** Take the user to the Sources panel when nothing can be generated yet. */
  onShowSources?: () => void;
}) {
  const [view, setView] = useState<"create" | "library">("create");
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState<InfographicStyle>(DEFAULT_STYLE);
  const [orientation, setOrientation] =
    useState<InfographicOrientation>("landscape");
  const [detail, setDetail] = useState<InfographicDetail>("standard");
  const [instructions, setInstructions] = useState("");
  const [describeOpen, setDescribeOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<StyleSuggestion[] | null>(
    null,
  );
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  /** Ask which styles suit the selected sources; the user still chooses. */
  const suggestStyles = async () => {
    setSuggesting(true);
    setSuggestError(null);
    try {
      const res = await fetch("/api/infographic/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notebookId,
          sourceIds: selectedIds,
          topic: topic.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        suggestions?: StyleSuggestion[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Could not suggest a style.");
      setSuggestions(json.suggestions ?? []);
    } catch (e) {
      setSuggestError(
        e instanceof Error ? e.message : "Could not suggest a style.",
      );
    } finally {
      setSuggesting(false);
    }
  };
  const [difficulty, setDifficulty] = useState<StudyDifficulty>("medium");
  const [length, setLength] = useState<StudyLength>("standard");
  const [slideTheme, setSlideTheme] = useState<SlideTheme>(DEFAULT_SLIDE_THEME);
  const [slideLength, setSlideLength] = useState<StudyLength>("standard");
  const [delivery, setDelivery] = useState<Delivery>("natural");
  const [audioLen, setAudioLen] = useState<AudioLength>("medium");
  const [narrator, setNarrator] = useState("Ava");
  const [motionNarrator, setMotionNarrator] = useState("Ava");
  const [motionForm, setMotionForm] = useState<MotionForm>(DEFAULT_MOTION_FORM);
  const defaults = narrationDefaults ?? EMPTY_NARRATION;
  const [narration, setNarration] = useState<
    Record<SpokenType, NarrationSettings>
  >(() => spokenRecord(defaults));
  /** Cards whose instructions were edited here are not overwritten by the saved default. */
  const touched = useRef<Set<SpokenType>>(new Set());
  const [music, setMusic] = useState<Record<SpokenType, MusicChoice | null>>(
    () => spokenRecord<MusicChoice | null>(null),
  );
  const defaultsKey = JSON.stringify(defaults);
  useEffect(() => {
    const d = JSON.parse(defaultsKey) as NarrationSettings;
    setNarration((prev) => {
      const next = { ...prev };
      for (const t of SPOKEN) if (!touched.current.has(t)) next[t] = d;
      return next;
    });
  }, [defaultsKey]);
  const editNarration = (t: SpokenType) => (v: NarrationSettings) => {
    touched.current.add(t);
    setNarration((prev) => ({ ...prev, [t]: v }));
  };
  const saveNarration = async (v: NarrationSettings) => {
    if (!onSaveNarration) return;
    const saved = await onSaveNarration(v);
    // Every card that matched the old default, or is the one saved from, follows the new one.
    touched.current.clear();
    setNarration(spokenRecord(saved));
  };
  const narrationFor = (t: SpokenType) => ({
    instructions: narration[t].instructions,
    replacements: narration[t].replacements.filter((r) => r.from.trim()),
  });
  const setMusicFor = (t: SpokenType) => (v: MusicChoice | null) =>
    setMusic((prev) => (prev[t] === v ? prev : { ...prev, [t]: v }));
  const [watermark, setWatermark] = useState<
    Record<VideoType, WatermarkChoice | null>
  >({
    video: null,
    motion: null,
    training: null,
  });
  const setWatermarkFor = (t: VideoType) => (v: WatermarkChoice | null) =>
    setWatermark((prev) => (prev[t] === v ? prev : { ...prev, [t]: v }));
  const [episodeProfile, setEpisodeProfile] = useState("deep-dive");
  const [speakers, setSpeakers] = useState<SpeakerConfig[]>(() =>
    profileSpeakers("deep-dive"),
  );
  const [speed, setSpeed] = useState(1);
  const [trainer, setTrainer] = useState(DEFAULT_PRESENTER);
  const [trainerVoice, setTrainerVoice] = useState(
    AVATAR_PRESETS[DEFAULT_PRESENTER].voice,
  );
  const [trainerStyle, setTrainerStyle] = useState<string | undefined>();
  const [trainerGallery, setTrainerGallery] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [trainingLen, setTrainingLen] = useState<AudioLength>("short");
  const [whiteboardLen, setWhiteboardLen] =
    useState<WhiteboardLength>("standard");
  const [whiteboardScenes, setWhiteboardScenes] = useState<number>(
    WHITEBOARD_LENGTHS.standard.scenes,
  );
  const [docLength, setDocLength] = useState<
    Partial<Record<ArtifactType, StudyLength>>
  >({});
  const [trainingBg, setTrainingBg] = useState(DEFAULT_BACKGROUND);
  const [trainingMode, setTrainingMode] = useState<"composed" | "presenter">(
    "composed",
  );
  const [trainingPalette, setTrainingPalette] = useState<
    keyof typeof MOTION_PALETTES
  >(DEFAULT_COMPOSITION.palette);
  const [running, setRunning] = useState<Set<ArtifactType>>(new Set());
  const [errors, setErrors] = useState<Partial<Record<ArtifactType, string>>>(
    {},
  );
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /** Play a speaker's sample, replacing whatever was playing. */
  const preview = async (name: string) => {
    previewAudio.current?.pause();
    setPreviewError(null);
    setPreviewing(null);
    // The first sample for a voice is synthesised on demand and can take
    // several seconds, so loading is shown distinctly from playing.
    setPreviewLoading(name);
    try {
      const res = await fetch(`/api/voice-preview/${encodeURIComponent(name)}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || "Could not play that voice.");
      }
      const url = URL.createObjectURL(await res.blob());
      const el = new Audio(url);
      previewAudio.current = el;
      const finish = () => {
        setPreviewing((p) => (p === name ? null : p));
        URL.revokeObjectURL(url);
      };
      el.onended = finish;
      el.onerror = finish;
      await el.play();
      setPreviewLoading(null);
      setPreviewing(name);
    } catch (e) {
      setPreviewError(
        e instanceof Error ? e.message : "Could not play that voice.",
      );
      setPreviewing(null);
      setPreviewLoading(null);
    }
  };

  /**
   * Generation runs in the background. A format is blocked only while that
   * same format is running — everything else in the studio, and every artifact
   * already made, stays usable while a long job finishes.
   */
  const run = async (
    type: ArtifactType,
    url: string,
    body: Record<string, unknown>,
  ) => {
    setRunning((prev) => new Set(prev).add(type));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await readJSONReply<ArtifactSummary & { error?: string }>(
        res,
        "Generation failed",
      );
      await onChanged();
      // Opened through the same path as a list entry so the modal always shows
      // the stored row rather than whatever the POST happened to return.
      onOpen(json as ArtifactSummary);
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [type]: e instanceof Error ? e.message : "Generation failed",
      }));
    } finally {
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  };

  const generate = (
    type: ArtifactType,
    override?: { style?: InfographicStyle },
  ) =>
    run(type, "/api/generate", {
      notebookId,
      type,
      topic: topic.trim() || undefined,
      sourceIds: selectedIds,
      ...(type === "infographic"
        ? {
            style: override?.style ?? style,
            orientation,
            detail,
            instructions: instructions.trim() || undefined,
          }
        : {}),
      ...(type === "slides" ? { theme: slideTheme, length: slideLength } : {}),
      ...(STUDIO[type].study ? { difficulty, length } : {}),
      ...(STUDIO[type].sized
        ? { length: docLength[type] ?? "standard" }
        : {}),
    });

  const generateAudio = () =>
    run("podcast", "/api/podcast", {
      notebookId,
      topic: topic.trim() || undefined,
      sourceIds: selectedIds,
      preset: delivery === "pinned" ? "classic" : "conversational",
      voices: { a: speakers[0]?.voice, b: speakers[1]?.voice },
      speakers: speakers.map(({ voice, name, role }) => ({
        voice,
        name: name.trim() || undefined,
        role: role.trim() || undefined,
      })),
      rate: speed,
      breath: delivery === "even" ? 0 : 1,
      length: audioLen,
      narration: narrationFor("podcast"),
      music: music.podcast,
    });

  const generateVideo = () =>
    run("video", "/api/video", {
      notebookId,
      topic: topic.trim() || undefined,
      sourceIds: selectedIds,
      voice: narrator,
      length: whiteboardLen,
      ...(whiteboardLen === "custom" ? { scenes: whiteboardScenes } : {}),
      narration: narrationFor("video"),
      music: music.video,
      watermark: watermark.video,
    });

  const generateMotion = () =>
    run("motion", "/api/motion", {
      notebookId,
      topic: topic.trim() || undefined,
      sourceIds: selectedIds,
      voice: motionNarrator,
      music: music.motion,
      watermark: watermark.motion,
      narration: narrationFor("motion"),
      ...motionRequest(motionForm),
    });

  const generateTraining = () =>
    run("training", "/api/training", {
      notebookId,
      topic: topic.trim() || undefined,
      sourceIds: selectedIds,
      presenter: trainer,
      voice: trainerVoice,
      voiceStyle: trainerStyle,
      background: trainingBg,
      length: trainingLen,
      narration: narrationFor("training"),
      music: music.training,
      watermark: watermark.training,
      composition: {
        ...DEFAULT_COMPOSITION,
        mode: trainingMode,
        palette: trainingPalette,
      },
    });

  const updateSpeaker = (i: number, patch: Partial<SpeakerConfig>) =>
    setSpeakers((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );

  const applyEpisodeProfile = (key: string) => {
    setEpisodeProfile(key);
    setSpeakers(profileSpeakers(key));
  };

  const blocked = !hasSources || selectedIds.length === 0;
  const audioBusy = running.has("podcast");
  const videoBusy = running.has("video");
  const motionBusy = running.has("motion");
  const trainingBusy = running.has("training");
  const pinnedVoices = delivery === "pinned";
  /** Fixed voices exist for only some speakers, so warn before generating. */
  const unpinnable = pinnedVoices
    ? speakers.map((s) => s.voice).filter((n) => !canPin(n))
    : [];
  const sharedVoices = speakers
    .map((s) => s.voice)
    .filter(
      (voice, i, all) =>
        all.indexOf(voice) !== i && all.lastIndexOf(voice) === i,
    );

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const deliveryLabel = {
    natural: "natural dialogue",
    even: "even delivery",
    pinned: "fixed voices",
  }[delivery];
  const audioSummary = `${
    EPISODE_PROFILES.find((p) => p.key === episodeProfile)?.label ?? "Custom"
  } · about ${AUDIO_LENGTHS[audioLen].minutes} min · ${
    speed === 1 ? "normal speed" : `${speed}× speed`
  } · ${deliveryLabel}`;
  const extras = (t: SpokenType) =>
    [
      music[t] ? "music" : "",
      t !== "podcast" && watermark[t] ? "watermark" : "",
      narration[t].instructions.trim() ? "instructions" : "",
    ]
      .filter(Boolean)
      .map((x) => ` · ${x}`)
      .join("");

  return (
    <aside
      aria-labelledby="studio-heading"
      className="flex h-full min-h-0 flex-col bg-[var(--panel)]"
    >
      <div className="px-4 pt-4 pb-3">
        <h2 id="studio-heading" className="sr-only">
          Studio
        </h2>
        <div
          role="group"
          aria-label="Studio view"
          className="mt-2 grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-well p-1"
        >
          {(["create", "library"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition ${
                view === v
                  ? "bg-hover text-[var(--fg)]"
                  : "text-[var(--muted)] hover:bg-hover hover:text-[var(--fg)]"
              }`}
            >
              {v === "create" ? "Create" : `Library (${artifacts.length})`}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[var(--muted)]">
          {view === "create"
            ? "Turn your selected sources into reports, audio, video, visuals and study aids."
            : "Everything generated in this notebook. Open one to read, play or export it."}
        </p>
      </div>

      {running.size > 0 && (
        <p
          role="status"
          className="mx-4 mb-3 flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-well px-3 py-2 text-[11px] text-[var(--muted)]"
        >
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--accent)]"
          />
          <span>
            Generating{" "}
            {[...running].map((t) => studioLabel(t).toLowerCase()).join(", ")}{" "}
            in the background. It opens when ready, and you can keep working
            meanwhile.
          </span>
        </p>
      )}

      {view === "library" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {artifacts.length === 0 ? (
            <div className="card px-4 py-6 text-center text-[11px] leading-relaxed text-[var(--muted)]">
              Nothing generated yet.
              <div className="mt-3">
                <button
                  className="btn !px-2.5 !py-1 !text-[11px]"
                  onClick={() => setView("create")}
                >
                  Choose a format to create
                </button>
              </div>
            </div>
          ) : (
            <ul className="space-y-1">
              {artifacts.map((a) => (
                <li
                  key={a.id}
                  className="group flex items-center gap-2 rounded-xl border border-transparent px-2 py-2 transition hover:border-[var(--border)] hover:bg-panel2"
                >
                  <span aria-hidden className="text-base">
                    {studioIcon(a.type)}
                  </span>
                  <button
                    className="min-w-0 flex-1 text-left disabled:opacity-60"
                    onClick={() => onOpen(a)}
                    disabled={openingId === a.id}
                  >
                    <div className="truncate text-[13px] font-medium">
                      {a.title}
                    </div>
                    <div className="text-[10px] text-dim">
                      {openingId === a.id
                        ? "Opening…"
                        : `${studioLabel(a.type)} · ${new Date(
                            a.createdAt,
                          ).toLocaleString()}`}
                    </div>
                  </button>
                  <button
                    aria-label={`Delete ${a.title}`}
                    className="reveal shrink-0 rounded px-1 text-xs text-[var(--muted)] transition hover:text-red-400"
                    onClick={() => onRemove(a)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {blocked && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-well px-3 py-2 text-[11px] text-[var(--muted)]">
              <span className="flex-1">
                {hasSources
                  ? "Tick at least one source to generate. Studio uses only the sources you tick."
                  : "Add a source to start creating. Everything here is built from your sources."}
              </span>
              {onShowSources && (
                <button
                  className="btn shrink-0 !px-2.5 !py-1 !text-[11px]"
                  onClick={onShowSources}
                >
                  Go to Sources
                </button>
              )}
            </div>
          )}

          <label
            htmlFor="studio-focus"
            className="mb-1 block text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase"
          >
            Focus{" "}
            <span className="font-normal tracking-normal normal-case">
              (optional): steers everything below
            </span>
          </label>
          <input
            id="studio-focus"
            className="input mb-4"
            placeholder="e.g. 'funding risks' or 'for new volunteers'"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />

          {onDiscuss && (
            <>
              <h3 className="mb-2 text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
                Live
              </h3>
              <button
                type="button"
                disabled={blocked}
                onClick={() => onDiscuss(topic)}
                className="card mb-4 flex w-full items-center gap-3 px-3 py-3 text-left transition hover:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden className="text-xl">
                  🎙️
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">
                    Live discussion
                  </span>
                  <span className="block text-[10px] leading-snug text-[var(--muted)]">
                    Talk it through out loud: discuss, debate, Q&amp;A,
                    interview or quiz, with cited answers
                  </span>
                </span>
                <span className="shrink-0 text-[11px] text-[var(--muted)]">
                  Start →
                </span>
              </button>
            </>
          )}

          <h3 className="mb-2 text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
            Audio &amp; video
          </h3>
          <p className="mb-2 text-[10px] leading-snug text-[var(--muted)]">
            Each one stops at an editable script, so nothing is narrated or
            rendered until you approve it.
          </p>

          <div className="space-y-2">
            <StudioCard
              icon="🎧"
              label="Audio overview"
              testId="audio-card"
              busy={audioBusy}
              blocked={blocked}
              error={errors.podcast}
              onGenerate={() => void generateAudio()}
              status={
                audioBusy
                  ? `Writing a script for about ${AUDIO_LENGTHS[audioLen].minutes} minutes…`
                  : speakers.length === 1
                    ? "A solo narration explains your sources"
                    : `${speakers.length} speakers discuss your sources`
              }
              summary={audioSummary + extras("podcast")}
              options={
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Profile
                    </span>
                    <select
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      aria-label="Audio profile"
                      value={episodeProfile}
                      onChange={(e) => applyEpisodeProfile(e.target.value)}
                    >
                      {EPISODE_PROFILES.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    {speakers.map((speaker, i) => (
                      <div
                        key={speaker.id}
                        className="rounded-lg border border-[var(--border)] bg-well/50 p-2"
                      >
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="w-5 shrink-0 text-[10px] font-semibold tracking-wide text-[var(--muted)] uppercase">
                            {speaker.id}
                          </span>
                          <SpeakerSelect
                            value={speaker.voice}
                            disabled={false}
                            onChange={(voice) => updateSpeaker(i, { voice })}
                            onPreview={preview}
                            previewing={previewing}
                            loading={previewLoading}
                          />
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          <input
                            className="min-w-0 rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none placeholder:text-faint focus:border-focus"
                            placeholder={`Optional name, e.g. ${
                              i === 0 ? "Host" : "Expert"
                            }`}
                            aria-label={`Speaker ${speaker.id} name`}
                            value={speaker.name}
                            onChange={(e) =>
                              updateSpeaker(i, { name: e.target.value })
                            }
                          />
                          <input
                            className="min-w-0 rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none placeholder:text-faint focus:border-focus"
                            placeholder="Role/personality, e.g. skeptical economist"
                            aria-label={`Speaker ${speaker.id} role`}
                            value={speaker.role}
                            onChange={(e) =>
                              updateSpeaker(i, { role: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Length
                    </span>
                    <select
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      aria-label="Audio length"
                      value={audioLen}
                      onChange={(e) =>
                        setAudioLen(e.target.value as AudioLength)
                      }
                    >
                      {(Object.keys(AUDIO_LENGTHS) as AudioLength[]).map(
                        (k) => (
                          <option key={k} value={k}>
                            {AUDIO_LENGTHS[k].label} — about{" "}
                            {AUDIO_LENGTHS[k].minutes} min
                          </option>
                        ),
                      )}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Speed
                    </span>
                    <select
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      aria-label="Speaking speed"
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      {RATE_CHOICES.map((r) => (
                        <option key={r} value={r}>
                          {r === 1 ? "Normal speed" : `${r}× speed`}
                        </option>
                      ))}
                    </select>
                    <select
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      aria-label="Delivery"
                      value={delivery}
                      onChange={(e) => setDelivery(e.target.value as Delivery)}
                    >
                      <option value="natural">Natural dialogue</option>
                      <option value="even">Even delivery</option>
                      <option value="pinned">Fixed voices</option>
                    </select>
                  </div>

                  {!pinnedVoices && (
                    <p className="text-[10px] leading-snug text-amber-200/90">
                      In this mode a speaker name only steers the multi-speaker
                      model, so a voice can drift, even to another gender.
                      Choose Fixed voices to guarantee that each name sounds
                      like itself.
                    </p>
                  )}
                  {pinnedVoices && (
                    <p className="text-[10px] leading-snug text-[var(--muted)]">
                      {unpinnable.length ? (
                        <span className="text-amber-200/90">
                          {unpinnable.join(" and ")}{" "}
                          {unpinnable.length === 1 ? "has" : "have"} no fixed
                          voice — pick from: {PINNABLE.join(", ")}.
                        </span>
                      ) : (
                        <>
                          Each turn is rendered by a named voice rather than by
                          the multi-speaker model, so the voice cannot drift.
                          Speakers stop handing off to each other, so it sounds
                          a little more read-aloud.
                        </>
                      )}
                    </p>
                  )}
                  {sharedVoices.length > 0 && (
                    <p className="text-[10px] leading-snug text-amber-200/90">
                      {sharedVoices.join(" and ")}{" "}
                      {sharedVoices.length === 1 ? "is used" : "are used"} by
                      more than one speaker. Distinct voices make the transcript
                      easier to follow.
                    </p>
                  )}
                  {previewError && (
                    <p className="text-[10px] leading-snug text-red-300">
                      {previewError}
                    </p>
                  )}
                  <MusicPicker
                    value={music.podcast}
                    onChange={setMusicFor("podcast")}
                  />
                  <NarrationOptions
                    value={narration.podcast}
                    onChange={editNarration("podcast")}
                    defaults={defaults}
                    onSaveDefault={onSaveNarration ? saveNarration : undefined}
                  />
                </>
              }
            />

            <StudioCard
              icon="🎬"
              label="Whiteboard video"
              testId="whiteboard-card"
              busy={videoBusy}
              blocked={blocked}
              error={errors.video}
              onGenerate={() => void generateVideo()}
              status={
                videoBusy
                  ? "Writing the scene plan…"
                  : "A hand draws your sources, narrated"
              }
              summary={`Voice: ${narrator} · ${
                whiteboardLen === "custom"
                  ? `${whiteboardScenes} scenes`
                  : WHITEBOARD_LENGTHS[whiteboardLen].label
              }${extras("video")}`}
              options={
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Voice
                    </span>
                    <SpeakerSelect
                      value={narrator}
                      disabled={false}
                      onChange={setNarrator}
                      onPreview={preview}
                      previewing={previewing}
                      loading={previewLoading}
                    />
                  </div>
                  {previewError && (
                    <p className="text-[10px] leading-snug text-red-300">
                      {previewError}
                    </p>
                  )}
                  <SceneLengthRow
                    label="Whiteboard video length"
                    value={whiteboardLen}
                    onChange={(k) => setWhiteboardLen(k as WhiteboardLength)}
                    scenes={whiteboardScenes}
                    onScenes={(n) =>
                      setWhiteboardScenes(clampWhiteboardScenes(n))
                    }
                    min={MIN_WHITEBOARD_SCENES}
                    max={MAX_WHITEBOARD_SCENES}
                    secondsPerScene={WHITEBOARD_SECONDS_PER_SCENE}
                    presets={(
                      Object.keys(WHITEBOARD_LENGTHS) as WhiteboardPreset[]
                    ).map((k) => ({
                      key: k,
                      text: `${WHITEBOARD_LENGTHS[k].label} — ${approxLength(
                        WHITEBOARD_LENGTHS[k].scenes *
                          WHITEBOARD_SECONDS_PER_SCENE,
                      )}, ${WHITEBOARD_LENGTHS[k].scenes} scenes`,
                    }))}
                  />
                  <MusicPicker
                    value={music.video}
                    onChange={setMusicFor("video")}
                  />
                  <WatermarkPicker
                    value={watermark.video}
                    onChange={setWatermarkFor("video")}
                  />
                  <NarrationOptions
                    value={narration.video}
                    onChange={editNarration("video")}
                    defaults={defaults}
                    onSaveDefault={onSaveNarration ? saveNarration : undefined}
                  />
                </>
              }
            />

            <StudioCard
              icon={STUDIO.motion.icon}
              label="Motion explainer"
              testId="motion-card"
              busy={motionBusy}
              blocked={blocked}
              error={errors.motion}
              onGenerate={() => void generateMotion()}
              status={
                motionBusy
                  ? "Writing the story…"
                  : "An animated 2D story, narrated"
              }
              summary={`Voice: ${motionNarrator} · ${
                motionForm.length === "custom"
                  ? `${motionSceneCount(motionForm)} scenes`
                  : MOTION_LENGTHS[motionForm.length].label.split(" (")[0]
              } · tone, style and colors${extras("motion")}`}
              options={
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Voice
                    </span>
                    <SpeakerSelect
                      value={motionNarrator}
                      disabled={false}
                      onChange={setMotionNarrator}
                      onPreview={preview}
                      previewing={previewing}
                      loading={previewLoading}
                    />
                  </div>
                  {previewError && (
                    <p className="text-[10px] leading-snug text-red-300">
                      {previewError}
                    </p>
                  )}
                  <SceneLengthRow
                    label="Motion explainer length"
                    value={motionForm.length}
                    onChange={(k) =>
                      setMotionForm((f) => ({
                        ...f,
                        length: k as MotionForm["length"],
                      }))
                    }
                    scenes={motionForm.scenes ?? MOTION_SCENE_COUNT}
                    onScenes={(n) =>
                      setMotionForm((f) => ({ ...f, scenes: n }))
                    }
                    min={MIN_CUSTOM_SCENES}
                    max={MAX_CUSTOM_SCENES}
                    secondsPerScene={MOTION_SECONDS_PER_SCENE}
                    presets={(Object.keys(MOTION_LENGTHS) as MotionLength[]).map(
                      (k) => ({
                        key: k,
                        text: `${MOTION_LENGTHS[k].label} — ${MOTION_LENGTHS[k].scenes} scenes`,
                      }),
                    )}
                  />
                  <MusicPicker
                    value={music.motion}
                    onChange={setMusicFor("motion")}
                  />
                  <WatermarkPicker
                    value={watermark.motion}
                    onChange={setWatermarkFor("motion")}
                  />
                  <NarrationOptions
                    value={narration.motion}
                    onChange={editNarration("motion")}
                    defaults={defaults}
                    onSaveDefault={onSaveNarration ? saveNarration : undefined}
                  />
                  <MotionCustomize
                    value={motionForm}
                    onChange={setMotionForm}
                  />
                </>
              }
            />

            <StudioCard
              icon={STUDIO.training.icon}
              label="Training video"
              testId="training-card"
              busy={trainingBusy}
              blocked={blocked}
              error={errors.training}
              onGenerate={() => void generateTraining()}
              status={
                trainingBusy
                  ? trainingMode === "composed"
                    ? "Writing the transcript and planning its visuals…"
                    : "Writing the transcript from your sources and notes…"
                  : "A presenter teaches your sources and notes. Nothing is billed until you render."
              }
              summary={`${AVATAR_PRESETS[trainer]?.label ?? trainer} · ${voiceNickname(trainerVoice)}${trainerStyle ? ` (${trainerStyle})` : ""} · about ${
                AUDIO_LENGTHS[trainingLen].minutes
              } min · ${trainingMode === "composed" ? "with slides" : "presenter only"}${extras(
                "training",
              )}`}
              options={
                <>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Trainer
                    </span>
                    <select
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      aria-label="Trainer"
                      value={trainer}
                      onChange={(e) => {
                        setTrainer(e.target.value);
                        setTrainerVoice(
                          AVATAR_PRESETS[e.target.value]?.voice ?? trainerVoice,
                        );
                        setTrainerStyle(undefined);
                      }}
                    >
                      {[false, true].map((photo) => (
                        <optgroup
                          key={String(photo)}
                          label={photo ? "Talking heads" : "Full body"}
                        >
                          {PRESENTER_ENTRIES
                            .filter(([, p]) => !!p.photo === photo)
                            .map(([key, p]) => (
                              <option key={key} value={key}>
                                {p.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarPicture(trainer)}
                      alt={`${AVATAR_PRESETS[trainer]?.label ?? trainer} avatar`}
                      className="h-12 w-9 shrink-0 rounded-md bg-white object-cover object-top"
                    />
                    <button
                      className="btn !px-2 !py-1 !text-[11px]"
                      onClick={() => setTrainerGallery(true)}
                    >
                      Compare
                    </button>
                    {trainerGallery && (
                      <PresenterGallery
                        current={trainer}
                        onClose={() => setTrainerGallery(false)}
                        onPick={(key, voice) => {
                          setTrainer(key);
                          setTrainerVoice(
                            voice ?? AVATAR_PRESETS[key]?.voice ?? trainerVoice,
                          );
                          setTrainerStyle(undefined);
                        }}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Live
                    </span>
                    <button
                      className="btn !px-2 !py-1 !text-[11px]"
                      onClick={() => setLiveOpen(true)}
                    >
                      Try a live VASA-2 presenter
                    </button>
                    {liveOpen && (
                      <LivePresenterModal onClose={() => setLiveOpen(false)} />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Voice
                    </span>
                    <VoicePicker
                      voiceLabelText="Presenter voice"
                      voice={trainerVoice}
                      style={trainerStyle}
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      onChange={(voice, style) => {
                        setTrainerVoice(voice);
                        setTrainerStyle(style);
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Length
                    </span>
                    <select
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      aria-label="Training video length"
                      value={trainingLen}
                      onChange={(e) =>
                        setTrainingLen(e.target.value as AudioLength)
                      }
                    >
                      {(Object.keys(AUDIO_LENGTHS) as AudioLength[]).map(
                        (k) => (
                          <option key={k} value={k}>
                            {AUDIO_LENGTHS[k].label} — about{" "}
                            {AUDIO_LENGTHS[k].minutes} min
                          </option>
                        ),
                      )}
                    </select>
                    <select
                      aria-label="Background"
                      className="w-28 shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      value={trainingBg}
                      onChange={(e) => setTrainingBg(e.target.value)}
                    >
                      {BACKGROUNDS.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                      Style
                    </span>
                    <select
                      className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                      aria-label="Training video style"
                      value={trainingMode}
                      onChange={(e) =>
                        setTrainingMode(
                          e.target.value as "composed" | "presenter",
                        )
                      }
                    >
                      <option value="composed">
                        Presenter with slides and visuals
                      </option>
                      <option value="presenter">Presenter only</option>
                    </select>
                    <select
                      aria-label="Visual theme"
                      className="w-28 shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus disabled:opacity-50"
                      value={trainingPalette}
                      disabled={trainingMode !== "composed"}
                      onChange={(e) =>
                        setTrainingPalette(
                          e.target.value as keyof typeof MOTION_PALETTES,
                        )
                      }
                    >
                      {(
                        Object.keys(
                          MOTION_PALETTES,
                        ) as (keyof typeof MOTION_PALETTES)[]
                      ).map((k) => (
                        <option key={k} value={k}>
                          {MOTION_PALETTES[k].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <MusicPicker
                    value={music.training}
                    onChange={setMusicFor("training")}
                  />
                  <WatermarkPicker
                    value={watermark.training}
                    onChange={setWatermarkFor("training")}
                  />
                  <NarrationOptions
                    value={narration.training}
                    onChange={editNarration("training")}
                    defaults={defaults}
                    onSaveDefault={onSaveNarration ? saveNarration : undefined}
                  />
                  <p className="text-[10px] leading-snug text-[var(--muted)]">
                    Uses the focus, selected sources and all notes.
                  </p>
                </>
              }
            />
          </div>

          {STUDIO_SECTIONS.map((section) => (
            <section
              key={section.key}
              className="mt-4"
              aria-labelledby={`studio-${section.key}`}
            >
              <h3
                id={`studio-${section.key}`}
                className="mb-2 text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase"
              >
                {section.label}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {section.types.map((type) => {
                  const s = STUDIO[type];
                  const isBusy = running.has(type);
                  const status = isBusy ? "Generating…" : s.blurb;

                  if (type === "slides") {
                    return (
                      <div key={type} className="col-span-2">
                        <StudioCard
                          icon={s.icon}
                          label={s.label}
                          busy={isBusy}
                          blocked={blocked}
                          error={errors[type]}
                          onGenerate={() => void generate(type)}
                          status={status}
                          summary={`${SLIDE_THEMES[slideTheme].label} theme · ${capitalize(slideLength)} length`}
                          options={
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                                Theme
                              </span>
                              <select
                                aria-label="Slide theme"
                                className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                                value={slideTheme}
                                onChange={(e) =>
                                  setSlideTheme(e.target.value as SlideTheme)
                                }
                              >
                                {(
                                  Object.keys(SLIDE_THEMES) as SlideTheme[]
                                ).map((k) => (
                                  <option key={k} value={k}>
                                    {SLIDE_THEMES[k].label}
                                  </option>
                                ))}
                              </select>
                              <span className="shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                                Length
                              </span>
                              <select
                                aria-label="Deck length"
                                className="shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                                value={slideLength}
                                onChange={(e) =>
                                  setSlideLength(e.target.value as StudyLength)
                                }
                              >
                                <option value="short">Short</option>
                                <option value="standard">Standard</option>
                                <option value="long">Long</option>
                              </select>
                            </div>
                          }
                        />
                      </div>
                    );
                  }

                  // Study aids carry their own level and length controls for the
                  // same reason the infographic carries its style picker: settings
                  // parked elsewhere in the panel read as global and get missed.
                  if (s.study) {
                    return (
                      <div key={type} className="col-span-2">
                        <StudioCard
                          icon={s.icon}
                          label={s.label}
                          busy={isBusy}
                          blocked={blocked}
                          error={errors[type]}
                          onGenerate={() => void generate(type)}
                          status={status}
                          summary={`${capitalize(difficulty)} level · ${capitalize(length)} length`}
                          options={
                            <div className="flex items-center gap-2">
                              <span className="shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                                Level
                              </span>
                              <select
                                className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                                aria-label="Difficulty level"
                                value={difficulty}
                                onChange={(e) =>
                                  setDifficulty(
                                    e.target.value as StudyDifficulty,
                                  )
                                }
                              >
                                <option value="easy">Easy</option>
                                <option value="medium">Medium</option>
                                <option value="hard">Hard</option>
                              </select>
                              <span className="shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                                Length
                              </span>
                              <select
                                className="shrink-0 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                                aria-label="Length"
                                value={length}
                                onChange={(e) =>
                                  setLength(e.target.value as StudyLength)
                                }
                              >
                                <option value="short">Short</option>
                                <option value="standard">Standard</option>
                                <option value="long">Long</option>
                              </select>
                            </div>
                          }
                        />
                      </div>
                    );
                  }

                  if (s.sized) {
                    const len = docLength[type] ?? "standard";
                    return (
                      <div key={type} className="col-span-2">
                        <StudioCard
                          icon={s.icon}
                          label={s.label}
                          busy={isBusy}
                          blocked={blocked}
                          error={errors[type]}
                          onGenerate={() => void generate(type)}
                          status={status}
                          summary={`${capitalize(len)} length`}
                          options={
                            <LengthRow
                              label={`${s.label} length`}
                              value={len}
                              onChange={(v) =>
                                setDocLength((prev) => ({ ...prev, [type]: v }))
                              }
                              choices={[
                                { key: "short", text: "Short" },
                                { key: "standard", text: "Standard" },
                                { key: "long", text: "Long" },
                              ]}
                            />
                          }
                        />
                      </div>
                    );
                  }

                  // The infographic has many styles, so its card carries its own
                  // chooser — with a live example of the chosen style — rather than
                  // a picker elsewhere in the panel that reads as a global setting.
                  if (type === "infographic") {
                    const chosen = INFOGRAPHIC_STYLES[style];
                    const segment = (active: boolean) =>
                      `px-2 py-1 text-[11px] transition ${
                        active
                          ? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--fg)]"
                          : "text-[var(--muted)] hover:text-[var(--fg)]"
                      }`;
                    return (
                      <div key={type} className="col-span-2">
                        <StudioCard
                          testId="infographic-card"
                          icon={s.icon}
                          label={s.label}
                          busy={isBusy}
                          blocked={blocked}
                          error={errors[type]}
                          onGenerate={() => void generate(type)}
                          status={
                            isBusy
                              ? isImageStyle(style)
                                ? "Writing the brief, then drawing it (about 2 minutes)…"
                                : "Generating…"
                              : s.blurb
                          }
                          summary={`${capitalize(orientation)} · ${capitalize(detail)} detail${
                            instructions.trim() ? " · description added" : ""
                          }`}
                          options={
                            <>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted)] transition hover:border-line-hover hover:text-[var(--fg)] disabled:opacity-40"
                                  disabled={blocked || suggesting}
                                  onClick={() => void suggestStyles()}
                                >
                                  {suggesting
                                    ? "Reading your sources…"
                                    : "✨ Suggest styles for my sources"}
                                </button>
                                {suggestions?.map((sg) => (
                                  <button
                                    key={sg.style}
                                    type="button"
                                    title={sg.reason}
                                    onClick={() => setStyle(sg.style)}
                                    aria-pressed={style === sg.style}
                                    className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                                      style === sg.style
                                        ? "border-[var(--accent)] text-[var(--fg)]"
                                        : "border-[var(--border)] text-[var(--muted)] hover:border-line-hover hover:text-[var(--fg)]"
                                    }`}
                                  >
                                    {INFOGRAPHIC_STYLES[sg.style].icon}{" "}
                                    {INFOGRAPHIC_STYLES[sg.style].label}
                                  </button>
                                ))}
                              </div>
                              {suggestError && (
                                <p className="text-[10px] text-red-400">
                                  {suggestError}
                                </p>
                              )}
                              {suggestions && suggestions.length > 0 && (
                                <p className="text-[10px] leading-snug text-[var(--muted)]">
                                  {suggestions.find((sg) => sg.style === style)
                                    ?.reason ??
                                    "Hover a suggestion to see why it fits."}
                                </p>
                              )}

                              <div className="flex flex-wrap items-center gap-2">
                                <span className="shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                                  Shape
                                </span>
                                <div
                                  role="radiogroup"
                                  aria-label="Orientation"
                                  className="flex overflow-hidden rounded-md border border-[var(--border)]"
                                >
                                  {ORIENTATIONS.map((o) => (
                                    <button
                                      key={o.key}
                                      type="button"
                                      role="radio"
                                      aria-checked={orientation === o.key}
                                      title={o.label}
                                      onClick={() => setOrientation(o.key)}
                                      className={segment(orientation === o.key)}
                                    >
                                      <span aria-hidden>{o.icon}</span>{" "}
                                      {o.label}
                                    </button>
                                  ))}
                                </div>
                                <label className="flex min-w-[9rem] flex-1 items-center gap-2">
                                  <span className="shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
                                    Detail
                                  </span>
                                  <select
                                    aria-label="Level of detail"
                                    className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                                    value={detail}
                                    onChange={(e) =>
                                      setDetail(
                                        e.target.value as InfographicDetail,
                                      )
                                    }
                                  >
                                    {DETAIL_LEVELS.map((d) => (
                                      <option key={d.key} value={d.key}>
                                        {d.label} — {d.blurb}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <div>
                                <button
                                  type="button"
                                  aria-expanded={describeOpen}
                                  onClick={() => setDescribeOpen((v) => !v)}
                                  className="flex w-full items-center gap-1.5 text-left text-[10px] tracking-wide text-[var(--muted)] uppercase hover:text-[var(--fg)]"
                                >
                                  <span aria-hidden>
                                    {describeOpen ? "▾" : "▸"}
                                  </span>
                                  Describe the infographic you want
                                  {instructions.trim() && !describeOpen && (
                                    <span className="ml-auto normal-case">
                                      · added
                                    </span>
                                  )}
                                </button>
                                {describeOpen && (
                                  <>
                                    <textarea
                                      aria-label="Describe the infographic you want"
                                      rows={3}
                                      maxLength={MAX_INFOGRAPHIC_INSTRUCTIONS}
                                      value={instructions}
                                      onChange={(e) =>
                                        setInstructions(e.target.value)
                                      }
                                      placeholder="e.g. For new volunteers. Focus on costs and the weekly schedule. Keep the tone upbeat."
                                      className="mt-1.5 w-full resize-y rounded-md border border-[var(--border)] bg-well px-2 py-1.5 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                                    />
                                    <p className="mt-0.5 text-right text-[10px] text-[var(--muted)]">
                                      {instructions.length}/
                                      {MAX_INFOGRAPHIC_INSTRUCTIONS} · steers
                                      focus and tone; facts still come only from
                                      your sources
                                    </p>
                                  </>
                                )}
                              </div>
                            </>
                          }
                        >
                          {/* The style is the main choice, so it stays in view. */}
                          <div className="border-t border-[var(--border)] px-3 py-2">
                            <button
                              type="button"
                              onClick={() => setGalleryOpen(true)}
                              aria-label={`Style: ${chosen.label}. Browse all ${STYLE_ORDER.length} styles with examples`}
                              className="group flex w-full items-center gap-2.5 rounded-md border border-[var(--border)] bg-well p-1.5 text-left transition hover:border-line-hover"
                            >
                              <span className="w-[5.5rem] shrink-0 overflow-hidden rounded border border-[var(--border)]">
                                <ScaledExample style={style} crop />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">
                                  {chosen.icon} {chosen.label}
                                </span>
                                <span className="block text-[10px] leading-snug text-[var(--muted)]">
                                  {STYLE_META[style].bestFor}
                                </span>
                                <span className="mt-0.5 block text-[10px] text-[var(--accent)] group-hover:underline">
                                  See examples of all {STYLE_ORDER.length}{" "}
                                  styles →
                                </span>
                              </span>
                            </button>
                          </div>
                        </StudioCard>

                        {galleryOpen && (
                          <InfographicGallery
                            value={style}
                            suggestions={suggestions ?? undefined}
                            canGenerate={!blocked && !isBusy}
                            onPick={setStyle}
                            onGenerate={(picked) =>
                              void generate("infographic", { style: picked })
                            }
                            onClose={() => setGalleryOpen(false)}
                          />
                        )}
                      </div>
                    );
                  }

                  return (
                    <div key={type} className="flex flex-col">
                      <button
                        disabled={blocked || isBusy}
                        onClick={() => void generate(type)}
                        aria-label={`Generate ${s.label}`}
                        className={`card group relative flex flex-1 flex-col overflow-hidden px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          isBusy
                            ? "shimmer border-[var(--accent)]"
                            : "hover:border-line-hover"
                        }`}
                      >
                        <div aria-hidden className="mb-1.5 text-lg">
                          {s.icon}
                        </div>
                        <div className="text-[13px] font-medium">{s.label}</div>
                        <div className="mt-0.5 flex-1 text-[10px] leading-snug text-[var(--muted)]">
                          {status}
                        </div>
                        {!isBusy && (
                          <div className="mt-2 text-[10px] font-medium text-[var(--muted)] transition group-hover:text-[var(--fg)]">
                            Generate →
                          </div>
                        )}
                      </button>
                      {errors[type] && (
                        <p
                          role="alert"
                          className="mt-1 px-1 text-[10px] leading-snug text-red-300"
                        >
                          {errors[type]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

/** "about 30 seconds" or "about 2.5 min". */
function approxLength(seconds: number): string {
  if (seconds < 90) return `about ${Math.round(seconds / 5) * 5} seconds`;
  return `about ${Math.round((seconds / 60) * 2) / 2} min`;
}

/** A labelled length dropdown, shared by the cards that size their output. */
function LengthRow<K extends string>({
  label,
  value,
  onChange,
  choices,
}: {
  label: string;
  value: K;
  onChange: (v: K) => void;
  choices: { key: K; text: string }[];
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
        Length
      </span>
      <select
        className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as K)}
      >
        {choices.map((c) => (
          <option key={c.key} value={c.key}>
            {c.text}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * One speaker's voice, shared by the audio and video controls.
 */
function SpeakerSelect({
  value,
  disabled,
  onChange,
  onPreview,
  previewing,
  loading,
}: {
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
  onPreview: (name: string) => void;
  previewing: string | null;
  loading: string | null;
}) {
  const playing = previewing === value;
  const isLoading = loading === value;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <select
        aria-label="Voice"
        className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus disabled:cursor-not-allowed disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <optgroup label="Female">
          {MULTITALKER_SPEAKERS.female.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </optgroup>
        <optgroup label="Male">
          {MULTITALKER_SPEAKERS.male.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </optgroup>
      </select>
      <button
        type="button"
        aria-label={`Hear ${value}`}
        title={`Hear ${value}`}
        disabled={disabled}
        onClick={() => onPreview(value)}
        className="shrink-0 rounded-md border border-[var(--border)] bg-well px-1.5 py-1 text-[11px] leading-none text-[var(--muted)] transition hover:border-line-hover hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isLoading ? "…" : playing ? "◼" : "▶"}
      </button>
    </div>
  );
}
