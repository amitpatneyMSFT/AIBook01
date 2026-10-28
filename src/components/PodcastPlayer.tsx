"use client";

import { useEffect, useRef, useState } from "react";
import type { PodcastContent, PodcastSpeakerId } from "@/lib/types";
import {
  podcastSettings,
  scriptOf,
  type PodcastScript,
  type ScriptTurn,
} from "@/lib/podcastscript";
import { EMPTY_NARRATION, readNarration, type NarrationSettings } from "@/lib/narration";
import { normalizeMusicChoice, type MusicChoice } from "@/lib/musicchoice";
import { MULTITALKER_SPEAKERS, RATE_CHOICES, WORDS_PER_MINUTE } from "@/lib/voices";
import { scrollBehavior } from "@/lib/reducedMotion";
import { readJSONReply } from "@/lib/jsonreply";
import MusicPicker from "./MusicPicker";
import NarrationOptions from "./NarrationOptions";

function clock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const SPEEDS = [1, 1.25, 1.5, 2];
const SPEAKER_COLORS: Record<PodcastSpeakerId, string> = {
  a: "text-[var(--speaker-a)]",
  b: "text-[var(--speaker-b)]",
  c: "text-[var(--speaker-c)]",
  d: "text-[var(--speaker-d)]",
};

function speakerLabel(content: PodcastContent, id: PodcastSpeakerId): string {
  const profile = content.speakers?.find((s) => s.id === id);
  return profile?.name?.trim() || content.voices[id] || id.toUpperCase();
}

function Player({ content }: { content: PodcastContent & { audioUrl: string } }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(content.durationSec || 0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const active = (() => {
    let idx = -1;
    for (let i = 0; i < content.turns.length; i++) {
      if (content.turns[i].at <= time + 0.15) idx = i;
      else break;
    }
    return idx;
  })();

  useEffect(() => {
    if (!follow || active < 0) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  }, [active, follow]);

  const seek = (to: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(to, duration || el.duration || 0));
    setTime(el.currentTime);
  };

  const chapters = content.chapters ?? [];
  const activeChapter = (() => {
    let idx = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].at <= time + 0.15) idx = i;
      else break;
    }
    return idx;
  })();

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div>
      <audio
        key={content.audioUrl}
        ref={audioRef}
        src={content.audioUrl}
        preload="metadata"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError("The audio file could not be loaded.")}
      />

      <div className="rounded-2xl border border-[var(--border)] bg-well p-5">
        {content.description && (
          <p className="mb-4 text-[13px] leading-relaxed text-[var(--muted)]">
            {content.description}
          </p>
        )}

        <div
          className="group relative h-2 cursor-pointer rounded-full bg-hover"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * (duration || 0));
          }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent)]"
            style={{ width: `${duration ? (time / duration) * 100 : 0}%` }}
          />
          {content.turns.map((t, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-line-hover"
              style={{ left: `${duration ? (t.at / duration) * 100 : 0}%` }}
            />
          ))}
          {/* Chapters sit above the turn ticks so a topic is findable on the
              bar itself, not only in the list below. */}
          {chapters.map((c, i) => (
            <span
              key={`c${i}`}
              aria-hidden
              title={c.title}
              className="absolute top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-link"
              style={{ left: `${duration ? (c.at / duration) * 100 : 0}%` }}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            className="btn !px-3"
            onClick={() => seek(time - 10)}
            aria-label="Back 10 seconds"
          >
            ↺10
          </button>
          <button
            className="btn btn-primary !h-10 !w-10 !rounded-full !px-0"
            onClick={toggle}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <button
            className="btn !px-3"
            onClick={() => seek(time + 10)}
            aria-label="Forward 10 seconds"
          >
            10↻
          </button>

          <span className="ml-1 font-mono text-xs text-[var(--muted)] tabular-nums">
            {clock(time)} / {clock(duration)}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn !px-2.5 !py-1 !text-xs"
              onClick={() => {
                const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
                setSpeed(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
              }}
            >
              {speed}×
            </button>
            <a className="btn !px-2.5 !py-1 !text-xs" href={content.audioUrl} download>
              Download
            </a>
          </div>
        </div>

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

        {chapters.length > 0 && (
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-widest text-[var(--muted)] uppercase">
                Topics
              </span>
              <select
                className="ml-auto min-w-0 max-w-[60%] cursor-pointer rounded-md border border-[var(--border)] bg-panel px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
                aria-label="Jump to topic"
                value={activeChapter >= 0 ? activeChapter : ""}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  if (Number.isInteger(i) && chapters[i]) seek(chapters[i].at);
                }}
              >
                {activeChapter < 0 && <option value="">Jump to a topic…</option>}
                {chapters.map((c, i) => (
                  <option key={i} value={i}>
                    {clock(c.at)} · {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {chapters.map((c, i) => (
                <button
                  key={i}
                  onClick={() => seek(c.at)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                    i === activeChapter
                      ? "border-[var(--accent)] bg-selected text-[var(--fg)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:border-line-hover hover:text-[var(--fg)]"
                  }`}
                >
                  <span className="font-mono tabular-nums opacity-70">{clock(c.at)}</span>{" "}
                  {c.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
          Transcript
        </h3>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <input
            type="checkbox"
            className="h-3 w-3 accent-[var(--accent)]"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow along
        </label>
      </div>

      <ul className="space-y-1">
        {content.turns.map((t, i) => {
          const isActive = i === active;
          return (
            <li
              key={i}
              ref={isActive ? activeRef : null}
              className={`flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 transition ${
                isActive ? "bg-selected" : "hover:bg-row"
              }`}
              onClick={() => seek(t.at)}
            >
              <span
                className={`mt-0.5 shrink-0 text-[10px] font-semibold tracking-wide uppercase ${
                  SPEAKER_COLORS[t.speaker]
                }`}
                style={{ minWidth: "3.2rem" }}
              >
                {speakerLabel(content, t.speaker)}
              </span>
              <p
                className={`flex-1 text-[14px] leading-relaxed ${
                  isActive ? "text-heading" : "text-prose-soft"
                }`}
              >
                {t.text}
              </p>
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-dim tabular-nums">
                {clock(t.at)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-well px-2.5 py-1.5 text-[13px] text-[var(--fg)] outline-none placeholder:text-faint focus:border-focus disabled:opacity-60";
const smallSelect =
  "cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus disabled:opacity-60";

type Draft = {
  title: string;
  script: PodcastScript;
  voices: Partial<Record<PodcastSpeakerId, string>>;
  rate: number;
  music: MusicChoice | null;
  narration: NarrationSettings;
};

const toDraft = (c: PodcastContent): Draft => ({
  title: c.title,
  script: {
    segments: scriptOf(c).segments.map((s) => ({
      title: s.title,
      turns: s.turns.map((t) => ({ ...t })),
    })),
  },
  voices: Object.fromEntries(
    (c.speakers ?? []).map((s) => [s.id, s.voice])
  ) as Partial<Record<PodcastSpeakerId, string>>,
  rate: podcastSettings(c).rate ?? 1,
  music: normalizeMusicChoice(c.musicChoice),
  narration: c.narration ? readNarration(c.narration) : EMPTY_NARRATION,
});

const countDraftWords = (s: PodcastScript) =>
  s.segments.reduce(
    (n, seg) => n + seg.turns.reduce((m, t) => m + (t.text.match(/\S+/g)?.length ?? 0), 0),
    0
  );

/**
 * An audio overview: the script editor until it has been narrated, then the
 * player, with the script a click away for edits and a fresh narration.
 */
export default function PodcastPlayer({
  artifactId,
  content,
  onRefresh,
}: {
  artifactId: string;
  content: PodcastContent;
  onRefresh?: () => Promise<void> | void;
}) {
  const narrated = Boolean(content.audioUrl);
  // A narration older than the server's timeout died with its process; the
  // next poll resets it, but the editor should not wait on it meanwhile.
  const serverNarrating =
    content.stage === "narrating" &&
    Date.now() - Number(content.narratingAt ?? 0) < 20 * 60_000;
  const [editing, setEditing] = useState(!narrated);
  const [draft, setDraft] = useState<Draft>(() => toDraft(content));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "narrate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const stored = JSON.stringify([
    content.title,
    content.script,
    content.speakers,
    content.settings,
    content.musicChoice,
    content.narration,
    content.audioUrl,
  ]);
  useEffect(() => {
    if (!dirtyRef.current) setDraft(toDraft(content));
    // `stored` captures every field toDraft reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  useEffect(() => {
    if (!narrated) setEditing(true);
  }, [narrated]);

  const narrating = busy === "narrate" || serverNarrating;
  useEffect(() => {
    if (!narrating) {
      setElapsed(0);
      return;
    }
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    // Another tab or an earlier visit may have started it; watch the row.
    const poll = serverNarrating && busy !== "narrate"
      ? setInterval(() => void Promise.resolve(refresh.current?.()).catch(() => {}), 5000)
      : null;
    return () => {
      clearInterval(tick);
      if (poll) clearInterval(poll);
    };
  }, [narrating, serverNarrating, busy]);

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const setSegments = (segments: PodcastScript["segments"]) =>
    edit({ script: { segments } });
  const editSegment = (i: number, patch: Partial<PodcastScript["segments"][number]>) =>
    setSegments(draft.script.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const editTurn = (si: number, ti: number, patch: Partial<ScriptTurn>) =>
    editSegment(si, {
      turns: draft.script.segments[si]!.turns.map((t, j) => (j === ti ? { ...t, ...patch } : t)),
    });
  const moveTurn = (si: number, ti: number, by: -1 | 1) => {
    const turns = [...draft.script.segments[si]!.turns];
    const j = ti + by;
    if (j < 0 || j >= turns.length) return;
    [turns[ti], turns[j]] = [turns[j]!, turns[ti]!];
    editSegment(si, { turns });
  };

  const save = async () => {
    const res = await fetch(`/api/podcast/${artifactId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: draft.title,
        script: draft.script,
        voices: draft.voices,
        rate: draft.rate,
        music: draft.music,
        narration: {
          instructions: draft.narration.instructions,
          replacements: draft.narration.replacements.filter((r) => r.from.trim()),
        },
      }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(j.error || "Could not save the script.");
    setDirty(false);
    await refresh.current?.();
  };

  const run = async (what: "save" | "narrate") => {
    setBusy(what);
    setError(null);
    try {
      if (dirty) await save();
      if (what === "narrate") {
        const res = await fetch(`/api/podcast/${artifactId}/narrate`, { method: "POST" });
        await readJSONReply(res, "Narration failed.");
        await refresh.current?.();
        setEditing(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      await Promise.resolve(refresh.current?.()).catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  const speakers: { id: PodcastSpeakerId; voice: string; name?: string }[] = content.speakers?.length
    ? content.speakers
    : (["a", "b"] as PodcastSpeakerId[]).map((id) => ({ id, voice: content.voices?.[id] ?? "" }));
  const words = countDraftWords(draft.script);
  const minutes = words / WORDS_PER_MINUTE / (draft.rate || 1);
  const locked = narrating || busy !== null;
  const allVoices = [...MULTITALKER_SPEAKERS.female, ...MULTITALKER_SPEAKERS.male];

  return (
    <div className="space-y-5">
      {narrated && !editing && content.audioUrl && (
        <>
          <Player content={content as PodcastContent & { audioUrl: string }} />
          <div className="flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[11px] text-[var(--muted)]">
              {content.music ? "With background music · " : ""}
              {content.editedSinceNarration
                ? "The script has changed since this was narrated."
                : "Want different wording? Edit the script and narrate it again."}
            </p>
            <button className="btn !text-xs" onClick={() => setEditing(true)}>
              Edit script
            </button>
          </div>
        </>
      )}

      {narrating && (
        <div className="rounded-2xl border border-[var(--border)] bg-well p-5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
            <span className="text-[13px] font-medium">Narrating the script</span>
            <span className="ml-auto font-mono text-[11px] text-[var(--muted)] tabular-nums">
              {clock(elapsed)}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">
            Every line is being voiced{draft.music ? " and the music mixed in" : ""}. Longer
            overviews take a few minutes.
          </p>
        </div>
      )}

      {content.note && !narrating && !error && (
        <p className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-[12px] text-amber-100">
          {content.note}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-900/50 bg-red-950/20 px-4 py-3 text-[13px] text-red-200">
          {error}
        </p>
      )}

      {editing && (
        <>
          {!narrated && (
            <p className="rounded-xl border border-[var(--border)] bg-well px-4 py-3 text-[12px] leading-relaxed text-[var(--muted)]">
              Review the script below — change any wording, reassign lines, or
              remove what you don&apos;t want said. Nothing is narrated until you
              press <span className="text-[var(--fg)]">Narrate</span>.
            </p>
          )}

          <section className="space-y-2 rounded-2xl border border-[var(--border)] p-4">
            <h3 className="text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
              Voices &amp; sound
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {speakers.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-[11px]">
                  <span className={`font-semibold uppercase ${SPEAKER_COLORS[s.id]}`}>
                    {s.name?.trim() || s.id}
                  </span>
                  <select
                    className={smallSelect}
                    disabled={locked}
                    value={draft.voices[s.id] ?? s.voice ?? ""}
                    onChange={(e) =>
                      edit({ voices: { ...draft.voices, [s.id]: e.target.value } })
                    }
                  >
                    {/* Older fixed-voice overviews stored full voice names. */}
                    {s.voice && !(allVoices as string[]).includes(s.voice) && (
                      <option value={s.voice}>{s.voice}</option>
                    )}
                    {allVoices.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <select
                aria-label="Speed"
                className={smallSelect}
                disabled={locked}
                value={draft.rate}
                onChange={(e) => edit({ rate: Number(e.target.value) })}
              >
                {RATE_CHOICES.map((r) => (
                  <option key={r} value={r}>
                    {r === 1 ? "Normal speed" : `${r}× speed`}
                  </option>
                ))}
              </select>
            </div>
            <MusicPicker value={draft.music} onChange={(music) => edit({ music })} disabled={locked} />
            <NarrationOptions
              value={draft.narration}
              onChange={(narration) => edit({ narration })}
              disabled={locked}
            />
            <p className="text-[10px] leading-snug text-[var(--muted)]">
              Instructions shape newly written scripts; the replacement list is
              applied to this script every time it is narrated.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-baseline gap-3">
              <h3 className="text-[11px] font-semibold tracking-widest text-[var(--muted)] uppercase">
                Script
              </h3>
              <span className="text-[11px] text-[var(--muted)] tabular-nums">
                {words.toLocaleString()} words · about {minutes.toFixed(1)} min
                {content.targetMinutes ? ` · target ${content.targetMinutes} min` : ""}
              </span>
            </div>
            <input
              className={`${inputCls} text-[15px] font-semibold`}
              aria-label="Title"
              value={draft.title}
              disabled={locked}
              onChange={(e) => edit({ title: e.target.value })}
            />

            {draft.script.segments.map((seg, si) => (
              <div key={si} className="rounded-xl border border-[var(--border)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    className={`${inputCls} font-medium`}
                    placeholder="Chapter title (optional)"
                    aria-label={`Chapter ${si + 1} title`}
                    value={seg.title}
                    disabled={locked}
                    onChange={(e) => editSegment(si, { title: e.target.value })}
                  />
                  <button
                    className="btn !px-2 !py-1 !text-xs hover:text-red-300"
                    aria-label={`Remove chapter ${si + 1}`}
                    disabled={locked || draft.script.segments.length <= 1}
                    onClick={() => setSegments(draft.script.segments.filter((_, j) => j !== si))}
                  >
                    ✕
                  </button>
                </div>
                <ol className="space-y-2">
                  {seg.turns.map((t, ti) => (
                    <li key={ti} className="flex gap-2">
                      <div className="flex w-24 shrink-0 flex-col gap-1">
                        <select
                          aria-label={`Speaker for line ${ti + 1}`}
                          className={`${smallSelect} ${SPEAKER_COLORS[t.speaker]}`}
                          disabled={locked}
                          value={t.speaker}
                          onChange={(e) =>
                            editTurn(si, ti, { speaker: e.target.value as PodcastSpeakerId })
                          }
                        >
                          {speakers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name?.trim() || draft.voices[s.id] || s.voice || s.id.toUpperCase()}
                            </option>
                          ))}
                        </select>
                        <div className="flex gap-1">
                          <button
                            className="btn !px-1.5 !py-0.5 !text-[10px]"
                            aria-label="Move line up"
                            disabled={locked || ti === 0}
                            onClick={() => moveTurn(si, ti, -1)}
                          >
                            ↑
                          </button>
                          <button
                            className="btn !px-1.5 !py-0.5 !text-[10px]"
                            aria-label="Move line down"
                            disabled={locked || ti === seg.turns.length - 1}
                            onClick={() => moveTurn(si, ti, 1)}
                          >
                            ↓
                          </button>
                          <button
                            className="btn !px-1.5 !py-0.5 !text-[10px] hover:text-red-300"
                            aria-label="Remove line"
                            disabled={locked}
                            onClick={() =>
                              editSegment(si, { turns: seg.turns.filter((_, j) => j !== ti) })
                            }
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      <textarea
                        className={`${inputCls} min-h-[4rem] flex-1 leading-relaxed`}
                        aria-label={`Line ${ti + 1}`}
                        value={t.text}
                        disabled={locked}
                        onChange={(e) => editTurn(si, ti, { text: e.target.value })}
                      />
                    </li>
                  ))}
                </ol>
                <button
                  className="mt-2 text-[11px] text-[var(--muted)] hover:text-[var(--fg)] disabled:opacity-50"
                  disabled={locked}
                  onClick={() =>
                    editSegment(si, {
                      turns: [
                        ...seg.turns,
                        {
                          speaker:
                            speakers[(seg.turns.length) % speakers.length]?.id ?? "a",
                          text: "",
                        },
                      ],
                    })
                  }
                >
                  + Add line
                </button>
              </div>
            ))}
            <button
              className="btn !text-xs"
              disabled={locked}
              onClick={() =>
                setSegments([
                  ...draft.script.segments,
                  { title: "", turns: [{ speaker: speakers[0]?.id ?? "a", text: "" }] },
                ])
              }
            >
              + Add chapter
            </button>
          </section>

          <div className="sticky -bottom-6 -mx-1 flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--panel)] px-1 pt-3 pb-9">
            <p className="mr-auto text-[11px] leading-snug text-[var(--muted)]">
              Spoken exactly as written. Avoid markdown, links and stage
              directions like [MUSIC] — they would be read aloud.
            </p>
            {narrated && (
              <button
                className="btn !text-xs"
                disabled={locked}
                onClick={() => {
                  setDraft(toDraft(content));
                  setDirty(false);
                  setEditing(false);
                }}
              >
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
              disabled={locked || words === 0}
              onClick={() => void run("narrate")}
            >
              {narrating ? "Narrating…" : narrated ? "Narrate again" : "Narrate"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
