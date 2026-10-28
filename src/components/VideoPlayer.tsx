"use client";

import { useEffect, useRef, useState } from "react";
import {
  MOTION_MOVEMENTS,
  describeMotionOptions,
  normalizeMotionOptions,
  type MotionMovement,
  type MotionPlan,
} from "@/lib/motion";
import type { VideoContent } from "@/lib/types";
import type { ScenePlan } from "@/lib/whiteboard";
import { EMPTY_NARRATION, readNarration, type NarrationSettings } from "@/lib/narration";
import { normalizeMusicChoice, type MusicChoice } from "@/lib/musicchoice";
import { normalizeWatermark, type WatermarkChoice } from "@/lib/watermarkchoice";
import { MULTITALKER_SPEAKERS, WORDS_PER_MINUTE } from "@/lib/voices";
import MusicPicker from "./MusicPicker";
import NarrationOptions from "./NarrationOptions";
import WatermarkPicker from "./WatermarkPicker";

const STAGES: Record<"whiteboard" | "motion", { key: string; label: string }[]> = {
  whiteboard: [
    { key: "artwork", label: "Drawing the scenes" },
    { key: "narration", label: "Recording narration" },
    { key: "rendering", label: "Rendering the video" },
  ],
  motion: [
    { key: "artwork", label: "Designing scenes and characters" },
    { key: "narration", label: "Recording narration" },
    { key: "rendering", label: "Animating the video" },
  ],
};

const BEAT_LABELS: Record<string, string> = {
  problem: "Problem",
  solution: "Solution",
  how: "How",
  benefits: "Benefits",
  cta: "Next step",
};

export default function VideoPlayer({
  artifactId,
  content,
  onRefresh,
  variant = "whiteboard",
}: {
  artifactId: string;
  content: VideoContent;
  /** Pulls the artifact again so progress advances while a build runs. */
  onRefresh: () => Promise<void> | void;
  variant?: "whiteboard" | "motion";
}) {
  const stages = STAGES[variant];
  const progress = content.progress;
  const stage = progress?.stage ?? (content.videoUrl ? "done" : "artwork");
  const inScript = stage === "script";
  const building = stage !== "done" && stage !== "failed" && !inScript;
  const editable = Boolean(content.plan);

  const [elapsed, setElapsed] = useState(0);
  const [editing, setEditing] = useState(false);

  // The caller passes a fresh closure on every render. Holding it in a ref
  // keeps it out of the effect's dependencies — with it in there, each poll
  // triggered a re-render, which produced a new callback, which restarted the
  // effect, which polled again: a loop firing every few milliseconds rather
  // than the intended four seconds.
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;

  useEffect(() => {
    if (!building) return;
    setEditing(false);
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    const poll = setInterval(() => {
      // Never let a failed poll surface as a page error. The build outlives
      // dev-server restarts, sleeping laptops and dropped connections.
      void Promise.resolve(refresh.current()).catch(() => {});
    }, 4000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [building]);

  if (editable && (inScript || editing)) {
    return (
      <ScriptEditor
        artifactId={artifactId}
        content={content}
        variant={variant}
        rendered={Boolean(content.videoUrl) || stage === "failed"}
        onCancel={inScript ? undefined : () => setEditing(false)}
        onRefresh={() => refresh.current()}
      />
    );
  }

  const editButton = editable ? (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <p className="mr-auto text-[11px] text-[var(--muted)]">
        {content.editedSinceRender
          ? "The script has changed since this video was rendered."
          : "Want different wording? Edit the script and render again."}
      </p>
      <button className="btn !text-xs" onClick={() => setEditing(true)}>
        Edit script
      </button>
    </div>
  ) : null;

  if (stage === "failed") {
    return (
      <div>
        <p className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-[13px] text-red-200">
          {progress?.note ?? "The video could not be built."}
        </p>
        {content.videoUrl && (
          <>
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              The previous video is unchanged:
            </p>
            <video
              key={content.videoUrl}
              src={content.videoUrl}
              controls
              preload="metadata"
              className="mt-2 w-full rounded-2xl border border-[var(--border)] bg-black"
            />
          </>
        )}
        {editButton}
        <SceneList content={content} />
      </div>
    );
  }

  if (building) {
    const idx = stages.findIndex((s) => s.key === stage);
    return (
      <div>
        <div className="rounded-2xl border border-[var(--border)] bg-well p-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            <span className="text-[13px] font-medium">
              {stages[idx]?.label ?? "Working"}
            </span>
            <span className="ml-auto font-mono text-[11px] text-[var(--muted)] tabular-nums">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {stages.map((s, i) => {
              const state = i < idx ? "done" : i === idx ? "now" : "todo";
              const pct =
                state === "done"
                  ? 100
                  : state === "now" && progress?.total
                    ? (progress.done / progress.total) * 100
                    : 0;
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <span
                    className={`w-40 shrink-0 text-[11px] ${
                      state === "todo" ? "text-dim" : "text-[var(--muted)]"
                    }`}
                  >
                    {s.label}
                  </span>
                  <div
                    role="progressbar"
                    aria-label={s.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pct)}
                    className="h-1 flex-1 overflow-hidden rounded-full bg-track-soft"
                  >
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-all motion-reduce:transition-none"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] text-[var(--muted)] tabular-nums">
                    {state === "now" && progress?.total
                      ? s.key === "rendering"
                        ? // The renderer reports a percent; before it does, or for a renderer that cannot, there is nothing to count.
                          progress.total > 1
                          ? `${Math.round(pct)}%`
                          : ""
                        : `${progress.done}/${progress.total}`
                      : state === "done"
                        ? "done"
                        : ""}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-4 text-[11px] leading-snug text-[var(--muted)]">
            This takes several minutes. You can close this and keep working —
            it carries on in the background.
          </p>
        </div>
        <SceneList content={content} />
      </div>
    );
  }

  return (
    <div>
      <video
        key={content.videoUrl}
        src={content.videoUrl}
        controls
        preload="metadata"
        className="w-full rounded-2xl border border-[var(--border)] bg-black"
      />
      <div className="mt-3 flex items-center gap-2">
        {content.description && (
          <p className="flex-1 text-[12px] leading-relaxed text-[var(--muted)]">
            {content.description}
          </p>
        )}
        <a
          className="btn shrink-0 !px-2.5 !py-1 !text-xs"
          href={content.videoUrl}
          download={`${content.title.replace(/[^\w\s-]/g, "").slice(0, 60) || "video"}.mp4`}
        >
          Download
        </a>
      </div>
      {progress?.note && (
        <p className="mt-2 text-[11px] text-amber-200/90">{progress.note}</p>
      )}
      {editButton}
      <SceneList content={content} />
      <p className="mt-4 text-[10px] text-[var(--muted)]">
        Narrated by {content.voice ?? "Ava"}
        {content.music ? " · with music" : ""}
        {content.watermarked ? " · watermarked" : ""}
        {describeMotionOptions(content.options).map((d) => ` · ${d}`).join("")}
        {content.bytes ? ` · ${(content.bytes / 1_048_576).toFixed(1)} MB` : ""}
      </p>
      <input type="hidden" value={artifactId} readOnly />
    </div>
  );
}

function SceneList({ content }: { content: VideoContent }) {
  if (!content.scenes?.length) return null;
  return (
    <>
      <h3 className="mt-6 mb-2 text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
        Scenes
      </h3>
      <ol className="space-y-1">
        {content.scenes.map((s, i) => (
          <li
            key={i}
            className="flex gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5"
          >
            <span className="mt-0.5 w-6 shrink-0 text-center text-[10px] font-semibold text-[var(--muted)]">
              {s.beat ? i + 1 : (s.step ?? "—")}
            </span>
            <div className="min-w-0 flex-1">
              {s.beat && (
                <div className="text-[10px] font-semibold tracking-widest text-[var(--accent)] uppercase">
                  {BEAT_LABELS[s.beat] ?? s.beat}
                </div>
              )}
              <div className="text-[12px] font-semibold tracking-wide">{s.title}</div>
              <div className="text-[12px] text-prose-soft">{s.caption}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
                {s.narration}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-well px-2.5 py-1.5 text-[13px] text-[var(--fg)] outline-none placeholder:text-faint focus:border-focus disabled:opacity-60";
const labelCls = "mb-1 block text-[10px] tracking-wide text-[var(--muted)] uppercase";

type EditScene = {
  /** Whiteboard: the hand-lettered title. Motion: the headline. */
  title: string;
  /** Whiteboard: caption band. Motion: subline. */
  caption: string;
  narration: string;
  /** Whiteboard only: what the image model draws. */
  drawing?: string;
  /** Motion only: short chips, comma separated while editing. */
  callouts?: string;
  /** Everything else about the scene, passed back untouched. */
  rest: Record<string, unknown>;
};

type ScriptDraft = {
  title: string;
  scenes: EditScene[];
  voice: string;
  music: MusicChoice | null;
  watermark: WatermarkChoice | null;
  narration: NarrationSettings;
  /** Motion explainers only. */
  movement: MotionMovement;
};

function toScriptDraft(c: VideoContent, variant: "whiteboard" | "motion"): ScriptDraft {
  const plan = c.plan as (ScenePlan | MotionPlan) | undefined;
  const scenes: EditScene[] =
    variant === "motion"
      ? ((plan as MotionPlan | undefined)?.scenes ?? []).map((s) => {
          const { headline, subline, narration, callouts, ...rest } = s;
          return {
            title: headline,
            caption: subline,
            narration,
            callouts: callouts.join(", "),
            rest,
          };
        })
      : ((plan as ScenePlan | undefined)?.scenes ?? []).map((s) => {
          const { title, caption, narration, drawing, ...rest } = s;
          return { title, caption, narration, drawing, rest };
        });
  return {
    title: plan?.title ?? c.title,
    scenes,
    voice: c.voice ?? "Ava",
    music: normalizeMusicChoice(c.musicChoice),
    watermark: normalizeWatermark(c.watermarkChoice),
    narration: c.narration ? readNarration(c.narration) : EMPTY_NARRATION,
    movement: normalizeMotionOptions(c.options ?? {}).movement,
  };
}

function fromScriptDraft(d: ScriptDraft, variant: "whiteboard" | "motion") {
  return d.scenes.map((s) =>
    variant === "motion"
      ? {
          ...s.rest,
          headline: s.title,
          subline: s.caption,
          narration: s.narration,
          callouts: (s.callouts ?? "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
        }
      : { ...s.rest, title: s.title, caption: s.caption, narration: s.narration, drawing: s.drawing }
  );
}

/**
 * The review step before a whiteboard or motion build: every scene's words
 * are editable, along with the voice, music and narration instructions.
 */
function ScriptEditor({
  artifactId,
  content,
  variant,
  rendered,
  onCancel,
  onRefresh,
}: {
  artifactId: string;
  content: VideoContent;
  variant: "whiteboard" | "motion";
  rendered: boolean;
  onCancel?: () => void;
  onRefresh: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<ScriptDraft>(() => toScriptDraft(content, variant));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "render" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const stored = JSON.stringify([
    content.plan,
    content.voice,
    content.musicChoice,
    content.watermarkChoice,
    content.narration,
    content.options,
  ]);
  useEffect(() => {
    if (!dirtyRef.current) setDraft(toScriptDraft(content, variant));
    // `stored` captures every field toScriptDraft reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const edit = (patch: Partial<ScriptDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const editScene = (i: number, patch: Partial<EditScene>) =>
    edit({ scenes: draft.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveScene = (i: number, by: -1 | 1) => {
    const next = [...draft.scenes];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    edit({ scenes: next });
  };

  const save = async () => {
    const res = await fetch(`/api/video/${artifactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        scenes: fromScriptDraft(draft, variant),
        voice: draft.voice,
        music: draft.music,
        watermark: draft.watermark,
        ...(variant === "motion" ? { movement: draft.movement } : {}),
        narration: {
          instructions: draft.narration.instructions,
          replacements: draft.narration.replacements.filter((r) => r.from.trim()),
        },
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(j.error || "Could not save the script.");
    setDirty(false);
    await onRefresh();
  };

  const run = async (what: "save" | "render") => {
    setBusy(what);
    setError(null);
    try {
      if (dirty) await save();
      if (what === "render") {
        const res = await fetch(`/api/video/${artifactId}/render`, { method: "POST" });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(j.error || "Could not start the render.");
        await onRefresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };

  const minScenes = variant === "motion" ? 3 : 2;
  const words = draft.scenes.reduce((n, s) => n + (s.narration.match(/\S+/g)?.length ?? 0), 0);
  const minutes = words / WORDS_PER_MINUTE;
  const locked = busy !== null;
  const voices = [...MULTITALKER_SPEAKERS.female, ...MULTITALKER_SPEAKERS.male];

  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-[var(--border)] bg-well px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
        {rendered
          ? "Edit the script, then render again. Rendering redraws the artwork and re-records the narration."
          : "Review the script below — change any wording or remove scenes. Nothing is drawn or recorded until you press "}
        {!rendered && <span className="text-[var(--fg)]">Render video</span>}
        {!rendered && "."}
      </p>

      {error && (
        <p className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-[13px] text-red-200">
          {error}
        </p>
      )}

      <section className="space-y-2 rounded-2xl border border-[var(--border)] p-4">
        <h3 className="text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
          Voice, sound &amp; watermark
        </h3>
        <div className="flex items-center gap-2">
          <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
            Voice
          </span>
          <select
            aria-label="Narrator voice"
            className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
            value={draft.voice}
            disabled={locked}
            onChange={(e) => edit({ voice: e.target.value })}
          >
            {voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {variant === "motion" && (
          <div className="flex items-center gap-2">
            <span className="w-11 shrink-0 text-[10px] tracking-wide text-[var(--muted)] uppercase">
              Motion
            </span>
            <select
              aria-label="Character motion"
              className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
              value={draft.movement}
              disabled={locked}
              onChange={(e) => edit({ movement: e.target.value as MotionMovement })}
            >
              {(Object.keys(MOTION_MOVEMENTS) as MotionMovement[]).map((k) => (
                <option key={k} value={k}>
                  {MOTION_MOVEMENTS[k].label}: {MOTION_MOVEMENTS[k].blurb}
                </option>
              ))}
            </select>
          </div>
        )}
        <MusicPicker value={draft.music} onChange={(music) => edit({ music })} disabled={locked} />
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
          Instructions shape newly written scripts; the replacement list is
          applied to this script when you save and when it renders.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
            Script
          </h3>
          <span className="text-[11px] text-[var(--muted)] tabular-nums">
            {draft.scenes.length} scenes · {words.toLocaleString()} words · about{" "}
            {minutes.toFixed(1)} min of narration
          </span>
        </div>
        <input
          className={`${inputCls} text-[15px] font-semibold`}
          aria-label="Title"
          value={draft.title}
          disabled={locked}
          onChange={(e) => edit({ title: e.target.value })}
        />

        <ol className="space-y-3">
          {draft.scenes.map((s, i) => {
            const beat = variant === "motion" ? String(s.rest.beat ?? "") : "";
            return (
              <li key={i} className="rounded-xl border border-[var(--border)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-[10px] font-semibold text-[var(--muted)]">
                    {i + 1}
                  </span>
                  {beat && (
                    <span className="shrink-0 text-[10px] font-semibold tracking-widest text-[var(--accent)] uppercase">
                      {BEAT_LABELS[beat] ?? beat}
                    </span>
                  )}
                  <input
                    className={`${inputCls} font-medium`}
                    aria-label={`Scene ${i + 1} ${variant === "motion" ? "headline" : "title"}`}
                    placeholder={variant === "motion" ? "Headline" : "Title"}
                    value={s.title}
                    disabled={locked}
                    onChange={(e) => editScene(i, { title: e.target.value })}
                  />
                  <button
                    className="btn !px-2 !py-1 !text-xs"
                    aria-label="Move up"
                    disabled={locked || i === 0}
                    onClick={() => moveScene(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="btn !px-2 !py-1 !text-xs"
                    aria-label="Move down"
                    disabled={locked || i === draft.scenes.length - 1}
                    onClick={() => moveScene(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="btn !px-2 !py-1 !text-xs hover:text-red-300"
                    aria-label="Remove scene"
                    disabled={locked || draft.scenes.length <= minScenes}
                    onClick={() => edit({ scenes: draft.scenes.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
                <div className="grid gap-2 pl-7">
                  <label className="block">
                    <span className={labelCls}>
                      {variant === "motion" ? "Subline on screen" : "Caption on screen"}
                    </span>
                    <input
                      className={inputCls}
                      value={s.caption}
                      disabled={locked}
                      onChange={(e) => editScene(i, { caption: e.target.value })}
                    />
                  </label>
                  {variant === "motion" && (
                    <label className="block">
                      <span className={labelCls}>Callout chips · comma separated</span>
                      <input
                        className={inputCls}
                        value={s.callouts ?? ""}
                        disabled={locked}
                        onChange={(e) => editScene(i, { callouts: e.target.value })}
                      />
                    </label>
                  )}
                  {variant === "whiteboard" && (
                    <label className="block">
                      <span className={labelCls}>What gets drawn</span>
                      <textarea
                        className={`${inputCls} min-h-[3rem] leading-relaxed`}
                        value={s.drawing ?? ""}
                        disabled={locked}
                        onChange={(e) => editScene(i, { drawing: e.target.value })}
                      />
                    </label>
                  )}
                  <label className="block">
                    <span className={labelCls}>Narration · spoken exactly as written</span>
                    <textarea
                      className={`${inputCls} min-h-[5rem] leading-relaxed`}
                      value={s.narration}
                      disabled={locked}
                      onChange={(e) => editScene(i, { narration: e.target.value })}
                    />
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="sticky -bottom-6 -mx-1 flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--panel)] px-1 pt-3 pb-9">
        <p className="mr-auto text-[11px] leading-snug text-[var(--muted)]">
          Rendering takes several minutes and uses the image and speech models.
        </p>
        {onCancel && (
          <button className="btn !text-xs" disabled={locked} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          className="btn !text-xs"
          disabled={!dirty || locked}
          onClick={() => void run("save")}
        >
          {busy === "save" ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        <button
          className="btn btn-primary !text-xs"
          disabled={locked || words === 0 || draft.scenes.length < minScenes}
          onClick={() => void run("render")}
        >
          {busy === "render" ? "Starting…" : rendered ? "Render again" : "Render video"}
        </button>
      </div>
    </div>
  );
}
