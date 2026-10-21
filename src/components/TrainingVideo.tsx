"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  InfographicContent,
  TrainingContent,
  TrainingSection,
} from "@/lib/types";
import { WORDS_PER_MINUTE } from "@/lib/voices";
import {
  AVATAR_PRESETS,
  BACKGROUNDS,
  MAX_AVATAR_MINUTES,
  PRESENTER_ENTRIES,
} from "@/lib/avatars";
import {
  GESTURE_NONE,
  gestureCatalog,
  gestureMode,
  sectionGesture,
  type GestureMode,
} from "@/lib/gestures";
import {
  EMPTY_NARRATION,
  readNarration,
  type NarrationSettings,
} from "@/lib/narration";
import { normalizeMusicChoice, type MusicChoice } from "@/lib/musicchoice";
import {
  normalizeWatermark,
  type WatermarkChoice,
} from "@/lib/watermarkchoice";
import {
  CUE_KIND_LABELS,
  LAYOUT_LABELS,
  anchorAt,
  compositionPalette,
  cueNeedsPicture,
  findAnchor,
  newCueId,
  normalizeComposition,
  tokenize,
  type TrainingComposition,
  type TrainingCue,
} from "@/lib/trainingvisuals";
import {
  composeInputOf,
  composeVocabulary,
  usableTimings,
  type SectionTiming,
} from "@/lib/trainingtimeline";
import MusicPicker from "./MusicPicker";
import WatermarkPicker from "./WatermarkPicker";
import NarrationOptions from "./NarrationOptions";
import TrainingCueEditor from "./TrainingCueEditor";
import TrainingDesign from "./TrainingDesign";
import PresenterGallery from "./PresenterGallery";
import LivePresenterModal from "./LivePresenterModal";
import TrainingPreview from "./TrainingPreview";
import VoicePicker from "./VoicePicker";
import type { VisualContext } from "./TrainingVisual";
import { prepareRasters } from "./trainingRaster";

const PRESENTER_STAGES: { key: string; label: string }[] = [
  { key: "submitting", label: "Sending the transcript to Azure" },
  { key: "submitted", label: "Queued for the avatar" },
  { key: "rendering", label: "Rendering the presenter" },
  { key: "downloading", label: "Saving the video" },
];

const COMPOSED_STAGES: { key: string; label: string }[] = [
  { key: "submitting", label: "Sending the sections to Azure" },
  { key: "submitted", label: "Queued for the avatar" },
  { key: "rendering", label: "Rendering the presenter, section by section" },
  { key: "composing", label: "Composing the visuals over the presenter" },
];

const IN_FLIGHT = new Set([
  "submitting",
  "submitted",
  "rendering",
  "downloading",
  "composing",
]);

type Tab = "script" | "visuals" | "design" | "preview";

type Draft = {
  title: string;
  objectives: string;
  sections: TrainingSection[];
  presenter: string;
  voice: string;
  /** Empty for the voice's default delivery. */
  voiceStyle: string;
  gestureMode: GestureMode;
  background: string;
  music: MusicChoice | null;
  watermark: WatermarkChoice | null;
  narration: NarrationSettings;
  composition: TrainingComposition;
};

const toDraft = (c: TrainingContent): Draft => ({
  title: c.title,
  objectives: (c.objectives ?? []).join("\n"),
  sections: c.sections.map((s) => ({
    ...s,
    cues: s.cues?.map((q) => ({ ...q })),
  })),
  presenter: c.presenter,
  voice: c.voice,
  voiceStyle: c.voiceStyle ?? "",
  gestureMode: gestureMode(c.gestureMode),
  background: c.background,
  music: normalizeMusicChoice(c.musicChoice),
  watermark: normalizeWatermark(c.watermarkChoice),
  narration: c.narration ? readNarration(c.narration) : EMPTY_NARRATION,
  composition: normalizeComposition(c.composition),
});

const words = (sections: Pick<TrainingSection, "text">[]) =>
  sections.reduce((n, s) => n + (s.text.match(/\S+/g)?.length ?? 0), 0);

const fmt = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-well px-2.5 py-1.5 text-[13px] text-[var(--fg)] outline-none placeholder:text-faint focus:border-focus disabled:opacity-60";

const KIND_DOT: Record<string, string> = {
  title: "bg-violet-400",
  objectives: "bg-emerald-400",
  bullets: "bg-blue-400",
  stat: "bg-amber-400",
  quote: "bg-pink-400",
  check: "bg-red-400",
  image: "bg-teal-400",
  screenshot: "bg-teal-400",
  infographic: "bg-purple-400",
  presenter: "bg-slate-400",
};

/** Character spans of each cue's anchor in a section, for highlighting. */
function anchorSpans(text: string, cues: TrainingCue[]) {
  const toks = tokenize(text);
  const spans: { start: number; end: number; cue: TrainingCue }[] = [];
  for (const q of cues) {
    const m = findAnchor(text, q.anchor, toks);
    if (!m) continue;
    const n = Math.max(1, tokenize(q.anchor).length);
    const last = toks[Math.min(toks.length - 1, m.word + n - 1)];
    spans.push({ start: toks[m.word].start, end: last.end, cue: q });
  }
  spans.sort((a, b) => a.start - b.start);
  return spans.filter((s, i) => i === 0 || s.start >= spans[i - 1].end);
}

export default function TrainingVideo({
  artifactId,
  content,
  onRefresh,
}: {
  artifactId: string;
  content: TrainingContent;
  onRefresh: () => Promise<void> | void;
}) {
  const stage = content.progress?.stage ?? "transcript";
  const rendering = IN_FLIGHT.has(stage);
  const savedComposed =
    normalizeComposition(content.composition).mode === "composed";

  const [draft, setDraft] = useState<Draft>(() => toDraft(content));
  const [dirty, setDirty] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [busy, setBusy] = useState<
    "save" | "render" | "plan" | "pictures" | null
  >(null);
  const [prep, setPrep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("script");
  const [timings, setTimings] = useState<(SectionTiming | null)[]>([]);
  const [timingInfo, setTimingInfo] = useState<{
    busy: boolean;
    note?: string;
    for?: string;
  }>({ busy: false });
  const [infographics, setInfographics] = useState<
    { id: string; title: string; content: InfographicContent }[]
  >([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
    section: number;
    text: string;
  } | null>(null);
  const since = content.progress?.submittedAt;
  const elapsed = since ? Math.max(0, (now - since) / 1000) : 0;
  const composed = draft.composition.mode === "composed";

  // Adopt the stored transcript whenever it changes underneath us, unless the
  // user is mid-edit — polling must never overwrite what they are typing.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const stored = JSON.stringify([
    content.title,
    content.objectives,
    content.sections,
    content.presenter,
    content.voice,
    content.background,
    content.musicChoice,
    content.watermarkChoice,
    content.narration,
    content.composition,
  ]);
  useEffect(() => {
    if (!dirtyRef.current) setDraft(toDraft(content));
    // `stored` captures every field toDraft reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  // Same guard as the whiteboard player: the caller's closure changes on every
  // render, and depending on it would restart the poll each tick.
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    if (!rendering) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      void Promise.resolve(refresh.current()).catch(() => {});
    }, 5000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [rendering]);

  useEffect(() => {
    if (!composed || infographics.length) return;
    let live = true;
    void fetch(`/api/training/${artifactId}/infographics`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then(
        (j: {
          items?: { id: string; title: string; content: InfographicContent }[];
        }) => {
          if (live) setInfographics(j.items ?? []);
        },
      )
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [artifactId, composed, infographics.length]);
  const infographicMap = useMemo(
    () => new Map(infographics.map((g) => [g.id, g.content])),
    [infographics],
  );

  const loadTimings = useCallback(async () => {
    setTimingInfo((s) => ({ ...s, busy: true }));
    try {
      const res = await fetch(`/api/training/${artifactId}/timing`);
      const j = (await res.json().catch(() => ({}))) as {
        timings?: SectionTiming[];
        note?: string;
        speech?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(j.error || "Could not time the speech.");
      setTimings(j.timings ?? []);
      setTimingInfo({
        busy: false,
        for: stored,
        note:
          j.note ??
          (j.speech === false &&
          (j.timings ?? []).some((x) => x.source !== "avatar")
            ? "Azure Speech is not configured, so timing is estimated and the preview is silent."
            : undefined),
      });
    } catch (e) {
      setTimingInfo({
        busy: false,
        for: stored,
        note: e instanceof Error ? e.message : "Could not time the speech.",
      });
    }
  }, [artifactId, stored]);

  useEffect(() => {
    if (
      composed &&
      savedComposed &&
      (tab === "preview" || tab === "visuals") &&
      timingInfo.for !== stored &&
      !timingInfo.busy
    ) {
      void loadTimings();
    }
  }, [
    composed,
    savedComposed,
    tab,
    stored,
    timingInfo.for,
    timingInfo.busy,
    loadTimings,
  ]);

  const edit = (patch: Partial<Draft> | ((d: Draft) => Partial<Draft>)) => {
    // Functional so a slow upload finishing later cannot undo edits made meanwhile.
    setDraft((d) => ({
      ...d,
      ...(typeof patch === "function" ? patch(d) : patch),
    }));
    setDirty(true);
  };
  const editSection = (
    i: number,
    patch:
      | Partial<TrainingSection>
      | ((s: TrainingSection) => Partial<TrainingSection>),
  ) =>
    edit((d) => ({
      sections: d.sections.map((s, j) =>
        j === i
          ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) }
          : s,
      ),
    }));
  const moveSection = (i: number, by: -1 | 1) => {
    const next = [...draft.sections];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    edit({ sections: next });
  };
  const patchCue = (i: number, id: string, patch: Partial<TrainingCue>) =>
    editSection(i, (s) => ({
      cues: (s.cues ?? []).map((q) => (q.id === id ? { ...q, ...patch } : q)),
    }));
  const removeCue = (i: number, id: string) =>
    editSection(i, (s) => ({
      cues: (s.cues ?? []).filter((q) => q.id !== id),
    }));
  const addCue = (i: number) => {
    const s = draft.sections[i];
    const anchor =
      selection?.section === i ? selection.text : anchorAt(s.text, 0, 5);
    const cue: TrainingCue = {
      id: newCueId(),
      kind: "bullets",
      anchor,
      layout: draft.composition.defaultLayout,
      transition: draft.composition.transition,
      title: "",
      bullets: [],
    };
    editSection(i, (sec) => ({ cues: [...(sec.cues ?? []), cue] }));
    setSelected(cue.id);
  };

  const patch = async (
    body: Record<string, unknown>,
  ): Promise<TrainingContent> => {
    const res = await fetch(`/api/training/${artifactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => ({}))) as {
      error?: string;
      content?: TrainingContent;
    };
    if (!res.ok || !j.content)
      throw new Error(j.error || "Could not save the transcript.");
    return j.content;
  };

  const save = async (): Promise<TrainingContent> => {
    const saved = await patch({
      title: draft.title,
      objectives: draft.objectives.split("\n"),
      sections: draft.sections,
      presenter: draft.presenter,
      voice: draft.voice,
      voiceStyle: draft.voiceStyle || null,
      gestureMode: draft.gestureMode,
      background: draft.background,
      music: draft.music,
      watermark: draft.watermark,
      narration: {
        instructions: draft.narration.instructions,
        replacements: draft.narration.replacements.filter((r) => r.from.trim()),
      },
      composition: draft.composition,
    });
    setDirty(false);
    await refresh.current();
    return saved;
  };

  /**
   * Find a screenshot on Microsoft Learn, or draw an illustration, for every
   * visual that is still without its picture. Returns updated copies.
   */
  const findPictures = async (
    sections: TrainingSection[],
    onStep: (n: number, total: number) => void,
  ): Promise<{ sections: TrainingSection[]; failed: number }> => {
    const next = sections.map((s) => ({
      ...s,
      cues: s.cues?.map((q) => ({ ...q })),
    }));
    const pending = next.flatMap((s) => (s.cues ?? []).filter(cueNeedsPicture));
    const used = next
      .flatMap((s) => s.cues ?? [])
      .map((q) => q.imageSource)
      .filter((u): u is string => Boolean(u));
    let failed = 0;
    let n = 0;
    for (const q of pending) {
      onStep(++n, pending.length);
      const res = await fetch(`/api/training/${artifactId}/assets/find`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: q.imageQuery,
          prompt: q.imagePrompt,
          exclude: used,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        imageId?: string;
        credit?: string;
        source?: string;
      };
      if (!res.ok || !j.imageId) {
        failed++;
        continue;
      }
      q.imageId = j.imageId;
      if (j.credit) q.imageCredit = j.credit;
      if (j.source) {
        q.imageSource = j.source;
        used.push(j.source);
      }
    }
    return { sections: next, failed };
  };

  /**
   * Everything a composed render needs from the browser: pictures that were
   * described but not yet drawn, then every visual rasterized for the
   * compositor. Only what changed since the last render is drawn again.
   */
  const prepareComposed = async (
    saved: TrainingContent,
  ): Promise<TrainingContent> => {
    // A visual with nothing to show would be drawn as a placeholder and cached as such.
    saved.sections.forEach((s, i) =>
      (s.cues ?? []).forEach((q) => {
        if (q.kind === "screenshot" && !q.imageId) {
          throw new Error(
            `Section ${i + 1} has a screenshot visual with no picture. Add one on the Visuals tab, or remove it.`,
          );
        }
        if (q.kind === "infographic" && !q.infographicId) {
          throw new Error(
            `Section ${i + 1} has an infographic visual with none chosen. Choose one on the Visuals tab, or remove it.`,
          );
        }
      }),
    );
    let graphics = infographicMap;
    if (
      saved.sections.some((s) =>
        s.cues?.some((q) => q.infographicId && !graphics.has(q.infographicId)),
      )
    ) {
      const res = await fetch(`/api/training/${artifactId}/infographics`);
      const j = (await res.json().catch(() => ({}))) as {
        items?: { id: string; title: string; content: InfographicContent }[];
      };
      setInfographics(j.items ?? []);
      graphics = new Map((j.items ?? []).map((g) => [g.id, g.content]));
      const gone = saved.sections
        .flatMap((s) => s.cues ?? [])
        .find((q) => q.infographicId && !graphics.has(q.infographicId));
      if (gone)
        throw new Error(
          "An infographic used by a visual has been deleted. Choose another on the Visuals tab.",
        );
    }
    let current = saved;
    const pending = saved.sections.flatMap((s, i) =>
      (s.cues ?? []).filter(cueNeedsPicture).map((q) => ({ i, q })),
    );
    if (pending.length) {
      const { sections, failed } = await findPictures(
        saved.sections,
        (n, total) => setPrep(`Finding picture ${n} of ${total}`),
      );
      current = await patch({ sections });
      if (failed) {
        setError(
          `${failed} visual${failed === 1 ? "" : "s"} got no picture and ${
            failed === 1 ? "shows" : "show"
          } words only. Add a picture on the Visuals tab if you want one.`,
        );
      }
    }
    setPrep("Drawing the visuals");
    await prepareRasters({
      artifactId,
      content: current,
      infographics: graphics,
      onProgress: (d, t) =>
        setPrep(t ? `Drawing visuals · ${d} of ${t}` : "Drawing the visuals"),
    });
    return current;
  };

  const run = async (what: "save" | "render") => {
    setBusy(what);
    setError(null);
    try {
      let saved = content;
      if (dirty) saved = await save();
      if (what === "render") {
        if (normalizeComposition(saved.composition).mode === "composed") {
          await prepareComposed(saved);
          setPrep("Starting the render");
        }
        const res = await fetch(`/api/training/${artifactId}/render`, {
          method: "POST",
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(j.error || "Could not start the render.");
        await refresh.current();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
      setPrep(null);
    }
  };

  const plan = async (section?: number) => {
    setBusy("plan");
    setError(null);
    try {
      if (dirty) await save();
      const res = await fetch(`/api/training/${artifactId}/visuals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(section === undefined ? {} : { section }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not plan the visuals.");
      await refresh.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not plan the visuals.");
    } finally {
      setBusy(null);
    }
  };

  const pictures = async () => {
    setBusy("pictures");
    setError(null);
    try {
      const saved = dirty ? await save() : content;
      const { sections, failed } = await findPictures(
        saved.sections,
        (n, total) => setPrep(`Finding picture ${n} of ${total}`),
      );
      await patch({ sections });
      setDirty(false);
      await refresh.current();
      if (failed) {
        setError(
          `${failed} visual${failed === 1 ? "" : "s"} got no picture. Open ${
            failed === 1 ? "it" : "them"
          } on the Visuals tab to try other search words, describe a picture or upload one.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not find pictures.");
    } finally {
      setBusy(null);
      setPrep(null);
    }
  };

  const wordCount = words(draft.sections);
  const minutes = wordCount / WORDS_PER_MINUTE;
  const tooLong = minutes > MAX_AVATAR_MINUTES * 0.95;
  const locked = rendering || busy !== null;
  const missingPictures = draft.sections.reduce(
    (n, s) => n + (s.cues ?? []).filter(cueNeedsPicture).length,
    0,
  );
  const picturesButton =
    missingPictures > 0 ? (
      <button
        className="btn !text-xs"
        disabled={locked || !savedComposed}
        onClick={() => void pictures()}
      >
        {busy === "pictures"
          ? "Finding pictures…"
          : `Add pictures to ${missingPictures} visual${missingPictures === 1 ? "" : "s"}`}
      </button>
    ) : null;

  const previewInput = useMemo(
    () =>
      composeInputOf({
        title: draft.title,
        objectives: draft.objectives
          .split("\n")
          .map((o) => o.trim())
          .filter(Boolean),
        sections: draft.sections,
        composition: draft.composition,
        description: content.description,
      }),
    [draft, content.description],
  );
  const liveTimings = useMemo(
    () =>
      usableTimings(
        draft.sections,
        draft.sections.map((_, i) => timings[i] ?? null),
      ),
    [draft.sections, timings],
  );

  const gestures = useMemo(() => gestureCatalog(draft.presenter), [draft.presenter]);

  // Sections whose presenter clip is already rendered for these exact words
  // cost nothing to render again; only the rest are billed.
  const presenterChanged =
    draft.presenter !== content.presenter ||
    draft.voice !== content.voice ||
    draft.voiceStyle !== (content.voiceStyle ?? "") ||
    draft.gestureMode !== gestureMode(content.gestureMode) ||
    draft.sections.some((s, i) => s.gesture !== content.sections[i]?.gesture) ||
    JSON.stringify(draft.narration) !==
      JSON.stringify(
        content.narration ? readNarration(content.narration) : EMPTY_NARRATION,
      );
  const uncached = composed
    ? draft.sections.filter(
        (_, i) => presenterChanged || liveTimings[i]?.source !== "avatar",
      )
    : draft.sections;
  const billableMinutes = words(uncached) / WORDS_PER_MINUTE;
  const cost =
    content.pricePerMinute && content.pricePerMinute > 0 && uncached.length
      ? Math.max(1, Math.ceil(billableMinutes)) * content.pricePerMinute
      : null;
  const recomposeOnly =
    composed && uncached.length === 0 && Boolean(content.videoUrl);

  const vocab = useMemo(
    () =>
      composeVocabulary({
        sections: draft.sections,
        description: content.description,
        objectives: draft.objectives.split("\n"),
      }),
    [draft.sections, draft.objectives, content.description],
  );
  const ctxFor = useCallback(
    (section?: number): VisualContext => ({
      title: draft.title,
      description: content.description,
      objectives: draft.objectives
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean),
      sectionTitle:
        section !== undefined ? draft.sections[section]?.title : undefined,
      sectionIndex: section,
      sectionCount: draft.sections.length,
      lowerName: draft.composition.lowerThird.name,
      lowerRole: draft.composition.lowerThird.role,
      vocab,
    }),
    [draft, content.description, vocab],
  );

  const stages = savedComposed ? COMPOSED_STAGES : PRESENTER_STAGES;
  const clips = content.progress?.clips ?? [];
  const clipsReady = clips.filter(
    (k) => k.status === "cached" || k.status === "done",
  ).length;

  const tabs: { key: Tab; label: string }[] = composed
    ? [
        { key: "script", label: "Script" },
        { key: "visuals", label: "Visuals" },
        { key: "design", label: "Design" },
        { key: "preview", label: "Preview" },
      ]
    : [
        { key: "script", label: "Script" },
        { key: "design", label: "Design" },
      ];
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "script";

  return (
    <div className="space-y-5">
      {stage === "done" && content.videoUrl && (
        <div>
          <video
            key={content.videoUrl}
            src={content.videoUrl}
            controls
            preload="metadata"
            className="w-full rounded-2xl border border-[var(--border)] bg-black"
          >
            {content.captionsUrl && (
              <track
                kind="captions"
                src={content.captionsUrl}
                srcLang="en"
                label="English"
                default={draft.composition.captions === "sidecar"}
              />
            )}
          </video>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
            {content.durationSec ? (
              <span>{fmt(content.durationSec)}</span>
            ) : null}
            {content.bytes ? (
              <span>{(content.bytes / 1_048_576).toFixed(1)} MB</span>
            ) : null}
            {content.music ? <span>With background music</span> : null}
            {content.watermarked ? <span>Watermarked</span> : null}
            {content.billedSeconds ? (
              <span>
                {Math.round(content.billedSeconds)} s of avatar time billed
              </span>
            ) : null}
            {content.captionsUrl && (
              <a
                className="underline hover:text-[var(--fg)]"
                href={content.captionsUrl}
                download={`${draft.title}.vtt`}
              >
                Captions (WebVTT)
              </a>
            )}
          </div>
          {(content.editedSinceRender || dirty) && (
            <p className="mt-2 text-[11px] text-amber-200/90">
              The video has changed since it was rendered. Render again to
              update it.
            </p>
          )}
        </div>
      )}

      {rendering && (
        <div className="rounded-2xl border border-[var(--border)] bg-well p-5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            <span className="text-[13px] font-medium">
              {stages.find((s) => s.key === stage)?.label ?? "Working"}
            </span>
            <span className="ml-auto font-mono text-[11px] text-[var(--muted)] tabular-nums">
              {fmt(elapsed)}
            </span>
          </div>
          <ol className="mt-3 space-y-1.5">
            {stages.map((s, i) => {
              const at = stages.findIndex((x) => x.key === stage);
              const state = i < at ? "done" : i === at ? "now" : "todo";
              return (
                <li key={s.key} className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      state === "done"
                        ? "bg-[var(--accent)]"
                        : state === "now"
                          ? "animate-pulse bg-[var(--accent)]"
                          : "bg-track"
                    }`}
                  />
                  <span
                    className={
                      state === "todo"
                        ? "text-dim"
                        : "text-[var(--muted)]"
                    }
                  >
                    {s.label}
                  </span>
                </li>
              );
            })}
          </ol>
          {savedComposed && clips.length > 0 && (
            <div
              className="mt-3 flex flex-wrap items-center gap-1"
              aria-label={`${clipsReady} of ${clips.length} sections ready`}
            >
              {clips.map((k, i) => (
                <span
                  key={i}
                  title={`Section ${i + 1}: ${k.status === "cached" ? "already rendered" : k.status}`}
                  className={`h-2 w-6 rounded-sm ${
                    k.status === "cached" || k.status === "done"
                      ? "bg-[var(--accent)]"
                      : k.status === "rendering"
                        ? "animate-pulse bg-[var(--accent)]/60"
                        : "bg-track"
                  }`}
                />
              ))}
              <span className="ml-2 text-[11px] text-[var(--muted)]">
                {clipsReady} of {clips.length} sections ready
              </span>
            </div>
          )}
          <p className="mt-3 text-[11px] leading-snug text-[var(--muted)]">
            Azure renders the presenter in the cloud, usually a little longer
            than the video runs. You can close this; it carries on, and survives
            a server restart.
          </p>
        </div>
      )}

      {stage === "failed" && (
        <p className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-[13px] text-red-200">
          {content.progress?.note ?? "The render failed."}
        </p>
      )}
      {stage !== "failed" && !rendering && content.progress?.note && (
        <p className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-[11px] text-amber-100">
          {content.progress.note}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-[13px] text-red-200">
          {error}
        </p>
      )}

      <div
        role="tablist"
        aria-label="Training video editor"
        className="flex gap-1 border-b border-[var(--border)]"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`training-tab-${t.key}`}
            aria-selected={activeTab === t.key}
            aria-controls={`training-panel-${t.key}`}
            className={`-mb-px border-b-2 px-3 py-1.5 text-[13px] ${
              activeTab === t.key
                ? "border-[var(--accent)] text-[var(--fg)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`training-panel-${activeTab}`}
        aria-labelledby={`training-tab-${activeTab}`}
        className="space-y-5"
      >
        {activeTab === "script" && (
          <>
            <section className="rounded-2xl border border-[var(--border)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
                  Presenter
                </h3>
                <select
                  aria-label="Presenter"
                  className={`${inputCls} !w-auto`}
                  value={draft.presenter}
                  disabled={locked}
                  onChange={(e) =>
                    edit({
                      presenter: e.target.value,
                      voice:
                        AVATAR_PRESETS[e.target.value]?.voice ?? draft.voice,
                      voiceStyle: "",
                    })
                  }
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
                <button
                  className="btn !text-[11px]"
                  disabled={locked}
                  onClick={() => setGallery(true)}
                >
                  Compare presenters
                </button>
                <button
                  className="btn !text-[11px]"
                  title="A live VASA-2 talking head speaks this transcript"
                  disabled={!draft.sections.length}
                  onClick={() => setLiveOpen(true)}
                >
                  Preview live (VASA-2)
                </button>
                {liveOpen && (
                  <LivePresenterModal
                    sections={draft.sections}
                    voice={draft.voice}
                    onClose={() => setLiveOpen(false)}
                  />
                )}
                {gallery && (
                  <PresenterGallery
                    current={draft.presenter}
                    onClose={() => setGallery(false)}
                    onPick={(key, voice) =>
                      edit({
                        presenter: key,
                        voice:
                          voice ?? AVATAR_PRESETS[key]?.voice ?? draft.voice,
                        voiceStyle: "",
                      })
                    }
                  />
                )}
                <VoicePicker
                  voice={draft.voice}
                  style={draft.voiceStyle}
                  className={`${inputCls} !w-auto`}
                  disabled={locked}
                  onChange={(voice, style) =>
                    edit({ voice, voiceStyle: style ?? "" })
                  }
                />
                <select
                  aria-label="Background"
                  className={`${inputCls} !w-auto`}
                  value={draft.background}
                  disabled={locked}
                  onChange={(e) => edit({ background: e.target.value })}
                >
                  {BACKGROUNDS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
                <span
                  aria-hidden
                  className="h-6 w-6 rounded-md border border-[var(--border)]"
                  style={{ background: draft.background }}
                />
                <select
                  aria-label="Body language"
                  title="Gestures the presenter makes while speaking"
                  className={`${inputCls} !w-auto`}
                  value={draft.gestureMode}
                  disabled={locked || !gestures.length}
                  onChange={(e) =>
                    edit({ gestureMode: gestureMode(e.target.value) })
                  }
                >
                  <option value="auto">Body language: varied</option>
                  <option value="off">Body language: still</option>
                </select>
              </div>
              <p className="mt-2 text-[10px] leading-snug text-[var(--muted)]">
                {gestures.length
                  ? "Varied adds a wave to open, open-handed gestures while explaining, and a thank-you to close. To choose a gesture for a section, use the menu on its heading. Gestures show only in the rendered video."
                  : "This presenter has no selectable gestures. Lisa casual seated, Lori, Harry, Max and Meg do."}
              </p>
              <div className="mt-3 space-y-2">
                <MusicPicker
                  value={draft.music}
                  onChange={(music) => edit({ music })}
                  disabled={locked}
                />
                <WatermarkPicker
                  value={draft.watermark}
                  onChange={(watermark) => edit({ watermark })}
                  disabled={locked}
                />
                <NarrationOptions
                  value={draft.narration}
                  onChange={(narration) => edit({ narration })}
                  disabled={locked}
                />
                <p className="text-[10px] leading-snug text-[var(--muted)]">
                  Instructions shape newly written transcripts; the replacement
                  list is applied to this transcript every time it renders.
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h3 className="text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
                  Transcript
                </h3>
                <span
                  className={`text-[11px] tabular-nums ${tooLong ? "text-red-300" : "text-[var(--muted)]"}`}
                >
                  {wordCount.toLocaleString()} words · about{" "}
                  {minutes.toFixed(1)} min
                  {tooLong
                    ? ` · over the ${MAX_AVATAR_MINUTES}-minute limit`
                    : ""}
                </span>
              </div>

              <input
                className={`${inputCls} text-[15px] font-semibold`}
                value={draft.title}
                disabled={locked}
                onChange={(e) => edit({ title: e.target.value })}
                aria-label="Title"
              />
              {content.description && (
                <p className="text-[13px] leading-relaxed text-[var(--muted)]">
                  {content.description}
                </p>
              )}

              <label className="block">
                <span className="mb-1 block text-[10px] tracking-wide text-[var(--muted)] uppercase">
                  Learning objectives · one per line
                  {composed ? "" : ", shown here only"}
                </span>
                <textarea
                  className={`${inputCls} min-h-[4.5rem] leading-relaxed`}
                  value={draft.objectives}
                  disabled={locked}
                  onChange={(e) => edit({ objectives: e.target.value })}
                />
              </label>

              <ol className="space-y-3">
                {draft.sections.map((s, i) => (
                  <li
                    key={i}
                    className="rounded-xl border border-[var(--border)] p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-[var(--muted)]">
                        {i + 1}
                      </span>
                      <input
                        className={`${inputCls} font-medium`}
                        value={s.title}
                        disabled={locked}
                        placeholder="Section title"
                        onChange={(e) =>
                          editSection(i, { title: e.target.value })
                        }
                        aria-label={`Section ${i + 1} title`}
                      />
                      {gestures.length > 0 && (
                        <select
                          aria-label={`Section ${i + 1} opening gesture`}
                          title="How the presenter moves as this section begins"
                          className={`${inputCls} !w-auto max-w-[11rem]`}
                          value={sectionGesture(draft.presenter, s.gesture) ?? ""}
                          disabled={locked}
                          onChange={(e) =>
                            editSection(i, {
                              gesture: e.target.value || undefined,
                            })
                          }
                        >
                          <option value="">Gesture: follow video</option>
                          <option value={GESTURE_NONE}>Gesture: none</option>
                          {gestures.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        className="btn !px-2 !py-1 !text-xs"
                        disabled={locked || i === 0}
                        onClick={() => moveSection(i, -1)}
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        className="btn !px-2 !py-1 !text-xs"
                        disabled={locked || i === draft.sections.length - 1}
                        onClick={() => moveSection(i, 1)}
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        className="btn !px-2 !py-1 !text-xs hover:text-red-300"
                        disabled={locked || draft.sections.length <= 1}
                        onClick={() =>
                          edit({
                            sections: draft.sections.filter((_, j) => j !== i),
                          })
                        }
                        aria-label="Remove section"
                      >
                        ✕
                      </button>
                    </div>
                    <textarea
                      className={`${inputCls} min-h-[8rem] leading-relaxed`}
                      value={s.text}
                      disabled={locked}
                      onChange={(e) => editSection(i, { text: e.target.value })}
                      aria-label={`Section ${i + 1} script`}
                    />
                    {composed && (s.cues?.length ?? 0) > 0 && (
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        {s.cues!.length} visual{s.cues!.length === 1 ? "" : "s"}{" "}
                        timed to this section ·{" "}
                        {s.cues!.filter((q) => !findAnchor(s.text, q.anchor))
                          .length > 0 ? (
                          <span className="text-amber-200">
                            some no longer match the words; check the Visuals
                            tab
                          </span>
                        ) : (
                          "all still match the words"
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ol>

              <button
                className="btn !text-xs"
                disabled={locked}
                onClick={() =>
                  edit({
                    sections: [...draft.sections, { title: "", text: "" }],
                  })
                }
              >
                + Add section
              </button>
            </section>
          </>
        )}

        {activeTab === "visuals" && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-[11px] leading-snug text-[var(--muted)]">
                Each visual appears when the presenter says its words. Select
                words in a section to place a new visual there.
              </p>
              {picturesButton}
              <button
                className="btn !text-xs"
                disabled={locked}
                onClick={() => void plan()}
              >
                {busy === "plan" ? "Planning…" : "Plan all visuals again"}
              </button>
            </div>
            {draft.sections.map((s, i) => {
              const cues = s.cues ?? [];
              const spans = anchorSpans(s.text, cues);
              const toks = tokenize(s.text);
              const ordered = [...cues].sort(
                (a, b) =>
                  (findAnchor(s.text, a.anchor, toks)?.word ?? 1e9) -
                  (findAnchor(s.text, b.anchor, toks)?.word ?? 1e9),
              );
              const parts: ReactNode[] = [];
              let at = 0;
              for (const sp of spans) {
                if (sp.start > at) parts.push(s.text.slice(at, sp.start));
                parts.push(
                  <mark
                    key={sp.cue.id}
                    className={`cursor-pointer rounded px-0.5 text-[var(--fg)] ${
                      selected === sp.cue.id
                        ? "bg-[var(--accent)]/40"
                        : "bg-[var(--accent)]/15"
                    }`}
                    onClick={() => setSelected(sp.cue.id)}
                    title={CUE_KIND_LABELS[sp.cue.kind]}
                  >
                    {s.text.slice(sp.start, sp.end)}
                  </mark>,
                );
                at = sp.end;
              }
              parts.push(s.text.slice(at));
              const here = selection?.section === i ? selection.text : null;
              return (
                <div
                  key={i}
                  className="rounded-xl border border-[var(--border)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h4 className="mr-auto text-[13px] font-medium">
                      {i + 1} · {s.title || "Untitled section"}
                    </h4>
                    <button
                      className="btn !px-2 !py-1 !text-[11px]"
                      disabled={locked}
                      onClick={() => void plan(i)}
                    >
                      Plan this section
                    </button>
                    <button
                      className="btn !px-2 !py-1 !text-[11px]"
                      disabled={locked}
                      onClick={() => addCue(i)}
                    >
                      {here ? "+ Add visual at selected words" : "+ Add visual"}
                    </button>
                  </div>
                  <p
                    className="max-h-48 overflow-y-auto rounded-lg bg-well px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--muted)]"
                    onMouseUp={() => {
                      const text =
                        window
                          .getSelection()
                          ?.toString()
                          .replace(/\s+/g, " ")
                          .trim() ?? "";
                      if (text)
                        setSelection({
                          section: i,
                          text: text.split(" ").slice(0, 12).join(" "),
                        });
                    }}
                  >
                    {parts}
                  </p>
                  {ordered.length === 0 ? (
                    <p className="mt-2 text-[11px] text-[var(--muted)]">
                      No visuals: the presenter is on screen alone.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {ordered.map((q) => (
                        <li key={q.id}>
                          <button
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-well ${
                              selected === q.id ? "bg-well" : ""
                            }`}
                            aria-expanded={selected === q.id}
                            onClick={() =>
                              setSelected(selected === q.id ? null : q.id)
                            }
                          >
                            <span
                              className={`h-2 w-2 shrink-0 rounded-full ${KIND_DOT[q.kind] ?? "bg-slate-400"}`}
                            />
                            <span className="w-36 shrink-0 font-medium">
                              {CUE_KIND_LABELS[q.kind]}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-[var(--muted)]">
                              “{q.anchor || "no words chosen"}”
                            </span>
                            <span className="hidden shrink-0 text-[10px] text-[var(--muted)] sm:inline">
                              {LAYOUT_LABELS[q.layout]}
                            </span>
                            {!findAnchor(s.text, q.anchor, toks) && (
                              <span className="shrink-0 text-[10px] text-red-300">
                                not found
                              </span>
                            )}
                          </button>
                          {selected === q.id && (
                            <div className="mt-1.5">
                              <TrainingCueEditor
                                artifactId={artifactId}
                                cue={q}
                                sectionText={s.text}
                                selection={here ?? ""}
                                infographics={infographics}
                                disabled={locked}
                                onChange={(p) => patchCue(i, q.id, p)}
                                onRemove={() => removeCue(i, q.id)}
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {activeTab === "design" && (
          <TrainingDesign
            artifactId={artifactId}
            value={draft.composition}
            disabled={locked}
            onChange={(p) =>
              edit((d) => ({ composition: { ...d.composition, ...p } }))
            }
          />
        )}

        {activeTab === "preview" && (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-auto text-[11px] leading-snug text-[var(--muted)]">
                {savedComposed
                  ? "Plays your unsaved edits on the measured timing. Nothing is billed."
                  : "Save to switch this video to presenter with visuals, then preview it here."}
              </p>
              {picturesButton}
              <button
                className="btn !text-xs"
                disabled={timingInfo.busy || !savedComposed}
                onClick={() =>
                  void (dirty ? save().then(loadTimings) : loadTimings())
                }
              >
                {timingInfo.busy
                  ? "Timing the speech…"
                  : dirty
                    ? "Save and retime"
                    : "Retime"}
              </button>
            </div>
            {timingInfo.note && (
              <p className="text-[11px] text-amber-200/90">{timingInfo.note}</p>
            )}
            <TrainingPreview
              input={previewInput}
              timings={liveTimings}
              background={draft.background}
              palette={compositionPalette(draft.composition)}
              ctxFor={ctxFor}
              infographics={infographicMap}
              selectedCueId={selected}
              onSelectCue={(_, id) => {
                setSelected(id);
                setTab("visuals");
              }}
            />
          </section>
        )}
      </div>

      <div className="sticky -bottom-6 -mx-1 flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--panel)] px-1 pt-3 pb-9">
        <p className="mr-auto text-[11px] leading-snug text-[var(--muted)]">
          {prep
            ? prep
            : composed
              ? `${uncached.length ? `${uncached.length} of ${draft.sections.length} sections need the presenter rendered` : "Every section's presenter is already rendered — no avatar cost"}${
                  cost !== null ? ` · est. $${cost.toFixed(2)}` : ""
                }`
              : `Spoken exactly as written, with subtitles burned in. Avoid markdown, links and stage directions.${
                  cost !== null ? ` Est. $${cost.toFixed(2)}.` : ""
                }`}
        </p>
        <button
          className="btn !text-xs"
          disabled={!dirty || locked}
          onClick={() => void run("save")}
        >
          {busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          className="btn btn-primary !text-xs"
          disabled={locked || tooLong || wordCount === 0}
          onClick={() => void run("render")}
        >
          {busy === "render"
            ? "Preparing…"
            : rendering
              ? "Rendering…"
              : recomposeOnly
                ? "Recompose video"
                : content.videoUrl
                  ? "Render again"
                  : "Render video"}
        </button>
      </div>
    </div>
  );
}
