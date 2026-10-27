"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import TrainingVisual, { Picture, type VisualContext } from "./TrainingVisual";
import type { MotionPalette } from "@/lib/motion";
import type { InfographicContent } from "@/lib/types";
import { CUE_KIND_LABELS, type TrainingCue } from "@/lib/trainingvisuals";
import {
  compileTrainingTimeline,
  rasterJobs,
  sampleAvatar,
  stateAt,
  type ComposeInput,
  type SectionTiming,
  type TimelineCue,
  type TrainingTimeline,
} from "@/lib/trainingtimeline";
import { prefersReducedMotion } from "@/lib/reducedMotion";

/**
 * The composed video, played in the browser from the same timeline the
 * compositor uses: visuals slide in as their phrase is spoken, the presenter
 * glides between layouts, captions follow the speech. The voice is measured
 * text-to-speech until the presenter is rendered, then the real transparent
 * presenter clips play in place of the placeholder.
 */

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const outCubic = (u: number) => 1 - (1 - u) ** 3;

const KIND_COLOR: Record<string, string> = {
  title: "#a78bfa",
  objectives: "#34d399",
  bullets: "#60a5fa",
  stat: "#fbbf24",
  quote: "#f472b6",
  check: "#f87171",
  image: "#2dd4bf",
  screenshot: "#2dd4bf",
  infographic: "#c084fc",
};

function cueLook(q: TimelineCue, t: number, reduced: boolean, timing: TrainingTimeline["timing"]) {
  let opacity = 1;
  let dx = 0;
  let scale = 1;
  let clip: string | undefined;
  const u = timing.cueIn ? clamp01((t - q.start) / timing.cueIn) : 1;
  if (u < 1 && q.transition !== "cut" && !reduced) {
    const e = outCubic(u);
    if (q.transition === "slide") [dx, opacity] = [(1 - e) * 0.08, e];
    else if (q.transition === "zoom") [scale, opacity] = [0.9 + 0.1 * e, e];
    else if (q.transition === "wipe") clip = `inset(0 ${(1 - e) * 100}% 0 0)`;
    else opacity = e;
  }
  if (t >= q.end) opacity *= timing.cueOut ? 1 - clamp01((t - q.end) / timing.cueOut) : 0;
  return { opacity, dx, scale, clip };
}

/**
 * Where the presenter will stand, until their clip is rendered: one of the
 * section's pictures, framed where the avatar's body sits, so the preview
 * shows the topic rather than a silhouette.
 */
function StandIn({ cue, palette, u }: { cue: TrainingCue | null; palette: MotionPalette; u: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "30%",
        top: "14%",
        width: "40%",
        height: "86%",
        borderRadius: "16px 16px 0 0",
        overflow: "hidden",
        background: `linear-gradient(160deg, ${palette.primary}, ${palette.dark})`,
        boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
      }}
    >
      {cue?.imageId && <Picture cue={cue} palette={palette} u={u} credit={false} />}
      {u > 4 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: u * 3,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            padding: `${u * 0.8}px ${u * 1.8}px`,
            borderRadius: 999,
            background: "rgba(10,12,16,0.72)",
            color: "#f4f6f8",
            fontSize: u * 2.5,
            fontWeight: 600,
          }}
        >
          Presenter appears here once rendered
        </div>
      )}
    </div>
  );
}

/**
 * The picture for the stand-in at time `t`: one not on screen right now, from
 * the current section when it has one, preferring the most recent.
 */
function standInCue(
  cues: TimelineCue[],
  cueById: Map<string, TrainingCue>,
  t: number,
  section: number | undefined,
  cueOut: number
): TrainingCue | null {
  const showing = new Set(
    cues
      .filter((q) => t >= q.start && t < q.end + cueOut)
      .map((q) => cueById.get(q.id)?.imageId)
      .filter(Boolean)
  );
  const pool = cues.filter((q) => {
    const id = cueById.get(q.id)?.imageId;
    return id && !showing.has(id);
  });
  if (!pool.length) return null;
  const here = pool.filter((q) => q.section === section);
  const from = here.length ? here : pool;
  const before = from.filter((q) => q.start <= t).at(-1);
  const pick = before ?? from.reduce((a, b) => (Math.abs(b.start - t) < Math.abs(a.start - t) ? b : a));
  return cueById.get(pick.id) ?? null;
}

export default function TrainingPreview({
  input,
  timings,
  background,
  palette,
  ctxFor,
  infographics,
  selectedCueId,
  onSelectCue,
}: {
  input: ComposeInput;
  timings: (SectionTiming | null)[];
  background: string;
  palette: MotionPalette;
  ctxFor: (section?: number) => VisualContext;
  infographics: Map<string, InfographicContent>;
  selectedCueId?: string | null;
  onSelectCue?: (section: number, id: string) => void;
}) {
  const tl = useMemo(() => compileTrainingTimeline(input, timings), [input, timings]);
  const jobs = useMemo(() => rasterJobs(input), [input]);
  const cueById = useMemo(() => {
    const m = new Map<string, TrainingCue>();
    input.sections.forEach((s) => s.cues?.forEach((q) => m.set(q.id, q)));
    return m;
  }, [input]);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [stageW, setStageW] = useState(640);
  const stageRef = useRef<HTMLDivElement>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const clock = useRef({ t: 0, at: 0 });
  const reduced = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageW(el.clientWidth));
    ro.observe(el);
    setStageW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const section = tl.sections.find((s) => t >= s.start && t < s.start + s.duration) ?? null;
  const timing = section ? timings[section.index] : null;
  const clipUrl = timing?.clipUrl && timing.source === "avatar" ? timing.clipUrl : null;
  const audioUrl = !clipUrl && timing?.audioUrl ? timing.audioUrl : null;

  const seek = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(tl.duration, to));
      clock.current = { t: next, at: performance.now() };
      setT(next);
      const m = mediaRef.current;
      if (m) {
        const s = tl.sections.find((x) => next >= x.start && next < x.start + x.duration);
        if (s && m.dataset.section === String(s.index)) m.currentTime = next - s.start;
      }
    },
    [tl]
  );

  useEffect(() => {
    if (!playing) {
      mediaRef.current?.pause();
      return;
    }
    clock.current = { t, at: performance.now() };
    let raf = 0;
    const tick = () => {
      let next = clock.current.t + (performance.now() - clock.current.at) / 1000;
      const s = tl.sections.find((x) => next >= x.start && next < x.start + x.duration);
      const m = mediaRef.current;
      if (s && m && m.dataset.section === String(s.index)) {
        const local = next - s.start;
        if (m.paused) {
          if (m.readyState >= 1 && Math.abs(m.currentTime - local) > 0.05) m.currentTime = local;
          void m.play().catch(() => {});
        } else if (Math.abs(m.currentTime - local) > 0.3) {
          m.currentTime = local;
        } else if (m.readyState >= 2) {
          // The voice is the master clock while it plays, so visuals never drift from it.
          next = s.start + m.currentTime;
          clock.current = { t: next, at: performance.now() };
        }
      }
      if (next >= tl.duration) {
        setT(tl.duration);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `t` seeds the clock only when playback starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, tl]);

  const k = stageW / tl.width;
  const pose = sampleAvatar(tl.avatar, t);
  const covering = tl.cards.some((c) => t >= c.start + tl.timing.cardFade && t < c.start + c.duration - tl.timing.cardFade);
  const caption = tl.captions.find((c) => t >= c.start && t < c.end);
  const W = tl.width;
  const H = tl.height;
  const px = (r: { x: number; y: number; w: number; h: number }) => ({
    left: r.x * W,
    top: r.y * H,
    width: Math.round(r.w * W),
    height: Math.round(r.h * H),
  });

  const visual = (q: TimelineCue, state: number, style: CSSProperties) => {
    const cue = cueById.get(q.id);
    const job = jobs.find((j) => j.key === q.rasterKey);
    if (!cue || !job || !q.panel) return null;
    return (
      <div key={`${q.id}-${state}`} style={{ position: "absolute", overflow: "hidden", ...px(q.panel), ...style }}>
        <div style={{ transform: q.kenBurns && !reduced ? `scale(${1 + 0.06 * clamp01((t - q.start) / Math.max(0.1, q.end - q.start))})` : undefined }}>
          <TrainingVisual
            role="cue"
            width={job.width}
            height={job.height}
            state={state}
            palette={palette}
            cue={cue}
            ctx={ctxFor(q.section)}
            infographic={cue.infographicId ? infographics.get(cue.infographicId) ?? null : null}
          />
        </div>
      </div>
    );
  };

  const presenterStyle: CSSProperties = {
    position: "absolute",
    width: W * pose.scale,
    height: H * pose.scale,
    left: pose.cx * W - (W * pose.scale) / 2,
    top: pose.cy * H - (H * pose.scale) / 2,
    opacity: pose.opacity,
  };

  return (
    <div className="space-y-2">
      <div
        ref={stageRef}
        className="relative w-full overflow-hidden rounded-xl border border-[var(--border)] bg-black"
        style={{ height: H * k }}
        role="img"
        aria-label={`Preview of the composed training video at ${fmt(t)} of ${fmt(tl.duration)}`}
      >
        <div
          style={{
            width: W,
            height: H,
            transform: `scale(${k})`,
            transformOrigin: "top left",
            position: "relative",
            background: `linear-gradient(180deg, ${background} 0%, color-mix(in srgb, ${background} 78%, black) 100%)`,
          }}
        >
          {!covering && (
            <>
              {tl.cues
                .filter((q) => t >= q.start && t < q.end + tl.timing.cueOut)
                .map((q) => {
                  const look = cueLook(q, t, reduced, tl.timing);
                  const s = stateAt(q, t);
                  const wrap: CSSProperties = {
                    opacity: look.opacity,
                    transform: `translateX(${look.dx * W}px) scale(${look.scale})`,
                    clipPath: look.clip,
                    boxShadow: q.panel && q.panel.w < 1 ? "0 18px 40px rgba(0,0,0,0.35)" : undefined,
                    borderRadius: 18,
                  };
                  const sinceReveal = t - q.states[s];
                  if (s > 0 && q.states[s] > q.start && sinceReveal < tl.timing.reveal && !reduced) {
                    return [
                      visual(q, s - 1, wrap),
                      visual(q, s, { ...wrap, opacity: look.opacity * clamp01(sinceReveal / tl.timing.reveal) }),
                    ];
                  }
                  return visual(q, s, wrap);
                })}
              {section && (
                <div style={{ ...presenterStyle, visibility: pose.opacity > 0.01 ? "visible" : "hidden" }}>
                  {clipUrl ? (
                    <video
                      key={clipUrl}
                      ref={(el) => {
                        mediaRef.current = el;
                      }}
                      data-section={section.index}
                      src={clipUrl}
                      playsInline
                      preload="auto"
                      onLoadedMetadata={(e) => {
                        // Mounted mid-section (a seek, or paused): show the frame for this moment.
                        e.currentTarget.currentTime = Math.max(0, clock.current.t - section.start);
                      }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <StandIn
                      cue={standInCue(tl.cues, cueById, t, section.index, tl.timing.cueOut)}
                      palette={palette}
                      u={(0.86 * H * pose.scale) / 100}
                    />
                  )}
                </div>
              )}
              {tl.lowerThird && t >= tl.lowerThird.start && t < tl.lowerThird.end && (
                <div
                  style={{
                    position: "absolute",
                    ...px(tl.lowerThird.rect),
                    opacity: (tl.timing.lowerIn ? clamp01((t - tl.lowerThird.start) / tl.timing.lowerIn) : 1) *
                      (tl.timing.lowerOut ? clamp01((tl.lowerThird.end - t) / tl.timing.lowerOut) : 1),
                    transform: tl.timing.lowerIn && !reduced
                      ? `translateX(${-0.4 * tl.lowerThird.rect.w * W * (1 - outCubic(clamp01((t - tl.lowerThird.start) / tl.timing.lowerIn)))}px)`
                      : undefined,
                  }}
                >
                  <TrainingVisual
                    role="lower"
                    width={Math.round(tl.lowerThird.rect.w * W)}
                    height={Math.round(tl.lowerThird.rect.h * H)}
                    state={0}
                    palette={palette}
                    ctx={ctxFor()}
                  />
                </div>
              )}
              {caption && (
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    bottom: H * 0.035,
                    transform: "translateX(-50%)",
                    maxWidth: W * 0.8,
                    background: "rgba(12,14,18,0.75)",
                    color: "#fff",
                    fontSize: H * 0.036,
                    lineHeight: 1.3,
                    padding: `${H * 0.012}px ${H * 0.025}px`,
                    borderRadius: H * 0.014,
                    textAlign: "center",
                  }}
                >
                  {caption.text}
                </div>
              )}
            </>
          )}
          {tl.cards
            .filter((c) => t >= c.start && t < c.start + c.duration)
            .map((c) => {
              const fadeIn = c.start <= 0.01 || !tl.timing.cardFade ? 1 : clamp01((t - c.start) / tl.timing.cardFade);
              const fadeOut = c.start + c.duration >= tl.duration - 0.01 || !tl.timing.cardFade ? 1 : clamp01((c.start + c.duration - t) / tl.timing.cardFade);
              return (
                <div key={c.rasterKey} style={{ position: "absolute", inset: 0, opacity: Math.min(fadeIn, fadeOut) }}>
                  <TrainingVisual role={c.role} width={W} height={H} state={0} palette={palette} ctx={ctxFor(c.section)} />
                </div>
              );
            })}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: "#000",
              opacity: reduced ? 0 : 1 - Math.min(
                tl.timing.edgeIn ? clamp01(t / tl.timing.edgeIn) : 1,
                tl.timing.edgeOut ? clamp01((tl.duration - t) / tl.timing.edgeOut) : 1
              ),
            }}
          />
        </div>
        {audioUrl && section && (
          <audio
            key={audioUrl}
            ref={(el) => {
              mediaRef.current = el;
            }}
            data-section={section.index}
            src={audioUrl}
            preload="auto"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = Math.max(0, clock.current.t - section.start);
            }}
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          className="btn btn-primary !px-3 !py-1 !text-xs"
          onClick={() => {
            if (!playing && t >= tl.duration - 0.05) seek(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "Pause preview" : "Play preview"}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <span className="font-mono text-[11px] text-[var(--muted)] tabular-nums">
          {fmt(t)} / {fmt(tl.duration)}
        </span>
        <input
          type="range"
          className="min-w-0 flex-1 accent-[var(--accent)]"
          min={0}
          max={tl.duration}
          step={0.1}
          value={t}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Preview position"
          aria-valuetext={`${fmt(t)} of ${fmt(tl.duration)}`}
        />
        <span className="shrink-0 text-[10px] text-[var(--muted)]">
          {timings.every((x) => x?.source === "avatar")
            ? "Rendered presenter"
            : timings.some((x) => x?.source === "tts" || x?.source === "avatar")
              ? "Measured voice timing · placeholder presenter"
              : "Estimated timing · silent preview"}
        </span>
      </div>

      <div
        className="relative h-9 w-full cursor-pointer rounded-md border border-[var(--border)] bg-well"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          seek(((e.clientX - r.left) / r.width) * tl.duration);
        }}
      >
        {tl.sections.map((s) => (
          <div
            key={s.index}
            className="absolute top-0 bottom-0 border-r border-[var(--border)] bg-track-soft"
            style={{ left: `${(s.start / tl.duration) * 100}%`, width: `${(s.duration / tl.duration) * 100}%` }}
            title={s.title}
          />
        ))}
        {tl.cues.map((q) => (
          <button
            key={q.id}
            className={`absolute top-1 bottom-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
              selectedCueId === q.id ? "ring-2 ring-white" : ""
            }`}
            style={{
              left: `${(q.start / tl.duration) * 100}%`,
              width: `max(4px, ${((q.end - q.start) / tl.duration) * 100}%)`,
              background: KIND_COLOR[q.kind] ?? "#94a3b8",
              opacity: q.match === "missing" ? 0.45 : 0.85,
            }}
            title={`${CUE_KIND_LABELS[q.kind]} at ${fmt(q.start)}${q.match === "missing" ? " (words not found)" : ""}`}
            aria-label={`${CUE_KIND_LABELS[q.kind]} at ${fmt(q.start)}`}
            onClick={(e) => {
              e.stopPropagation();
              seek(q.start);
              onSelectCue?.(q.section, q.id);
            }}
          />
        ))}
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[var(--fg)]"
          style={{ left: `${(t / Math.max(0.001, tl.duration)) * 100}%` }}
        />
      </div>

      {tl.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-100">
          {tl.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
