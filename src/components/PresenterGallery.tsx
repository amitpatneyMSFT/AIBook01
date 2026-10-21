"use client";

import { useEffect, useRef, useState } from "react";
import {
  AVATAR_PRESETS,
  PRESENTER_ENTRIES,
  avatarPicture,
  presenterName,
} from "@/lib/avatars";
import { HD_ALTERNATES, hdCandidates, PINNED_VOICES } from "@/lib/voices";
import type { CatalogVoice } from "@/lib/voicecatalog";
import { loadVoices } from "./VoicePicker";
import { useDialog } from "./useDialog";

const entries = PRESENTER_ENTRIES;

/**
 * Every presenter at a glance, each with a sample of the voice it comes with,
 * so one can be chosen by eye and ear. Samples are the voice only: rendering a
 * real avatar clip is billed, so none is made here.
 */
export default function PresenterGallery({
  current,
  onPick,
  onClose,
}: {
  current: string;
  /** `voice` is set when the Dragon HD version was chosen. */
  onPick: (key: string, voice?: string) => void;
  onClose: () => void;
}) {
  const { dialogRef, backdropProps } = useDialog(onClose);
  const [playing, setPlaying] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [group, setGroup] = useState<"body" | "heads">(
    AVATAR_PRESETS[current]?.photo ? "heads" : "body",
  );
  const shown = entries.filter(([, p]) => !!p.photo === (group === "heads"));
  const [failed, setFailed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const run = useRef(0);
  const [live, setLive] = useState<CatalogVoice[]>([]);

  useEffect(() => {
    let on = true;
    void loadVoices().then((v) => on && setLive(v));
    return () => {
      on = false;
    };
  }, []);

  /** HD voices for a presenter that the Speech resource offers, best first. */
  const hdOptions = (key: string) => {
    const voice = AVATAR_PRESETS[key].voice;
    const byLower = new Map(live.map((v) => [v.id.toLowerCase(), v.id]));
    const base = hdCandidates(voice)
      .map((c) => byLower.get(c.toLowerCase()))
      .find(Boolean);
    const out: { id: string; label: string }[] = base
      ? [{ id: base, label: "HD" }]
      : [];
    for (const alt of HD_ALTERNATES[voice] ?? []) {
      const id = byLower.get(alt.id.toLowerCase());
      if (id) out.push({ id, label: `HD ${alt.label}` });
    }
    return out;
  };
  const stop = () => {
    run.current++;
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
    setAll(false);
  };

  useEffect(
    () => () => {
      run.current++;
      audio.current?.pause();
    },
    [],
  );

  /** Resolves true when the sample played to its end. */
  const sample = (key: string, token: number, hd: string | null = null) =>
    new Promise<boolean>((resolve) => {
      const voice = AVATAR_PRESETS[key].voice;
      const id = hd || PINNED_VOICES[voice] || voice;
      const tag = hd ? `${key}|${hd}` : key;
      const a = new Audio(
        `/api/voices/preview?${new URLSearchParams({
          voice: id,
          as: presenterName(AVATAR_PRESETS[key].label),
        })}`,
      );
      audio.current = a;
      setPlaying(tag);
      setFailed(null);
      const done = (ok: boolean) => {
        if (run.current !== token) return resolve(false);
        if (!ok) setFailed(tag);
        resolve(ok);
      };
      a.onended = () => done(true);
      a.onerror = () => done(false);
      a.play().catch(() => done(false));
    });

  const playOne = async (key: string, hd: string | null = null) => {
    if (playing === (hd ? `${key}|${hd}` : key) && !all) return stop();
    stop();
    const token = run.current;
    await sample(key, token, hd);
    if (run.current === token) setPlaying(null);
  };

  const playAll = async () => {
    stop();
    const token = run.current;
    setAll(true);
    for (const [key] of shown) {
      // A voice shared by several styles is heard once.
      const first = shown.find(
        ([, p]) => p.voice === AVATAR_PRESETS[key].voice,
      )?.[0];
      if (first !== key) continue;
      if (run.current !== token || !(await sample(key, token))) break;
      let aborted = false;
      for (const o of hdOptions(key)) {
        if (run.current !== token || !(await sample(key, token, o.id))) {
          aborted = true;
          break;
        }
      }
      if (aborted) break;
    }
    if (run.current === token) stop();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      {...backdropProps}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gallery-title"
        className="fade-up card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden !p-0 outline-none"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="gallery-title" className="text-[15px] font-semibold">
              Compare presenters
            </h2>
            <p className="text-[11px] text-[var(--muted)]">
              Listen to each presenter&apos;s voice and choose one. Pictures are
              from Microsoft Learn; the voice samples are audio only, so no
              avatar video is rendered or billed here.
            </p>
          </div>
          <button className="btn !text-[11px]" onClick={all ? stop : playAll}>
            {all ? "Stop" : "Play all voices"}
          </button>
          <button
            aria-label="Close"
            className="btn !px-2.5 !py-1.5 !text-xs"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div
          role="tablist"
          aria-label="Presenter type"
          className="flex shrink-0 gap-2 border-b border-[var(--border)] px-5 py-2"
        >
          {(
            [
              ["body", "Full body"],
              ["heads", "Talking heads"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={group === id}
              className={`btn !px-3 !py-1 !text-[11px] ${group === id ? "btn-primary" : ""}`}
              onClick={() => {
                stop();
                setGroup(id);
              }}
            >
              {label} ·{" "}
              {entries.filter(([, p]) => !!p.photo === (id === "heads")).length}
            </button>
          ))}
        </div>
        <ul className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3">
          {shown.map(([key, p]) => {
            const selected = key === current;
            const hds = hdOptions(key);
            return (
              <li
                key={key}
                className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center ${
                  selected
                    ? "border-[var(--accent)] bg-well"
                    : "border-[var(--border)]"
                } ${playing?.split("|")[0] === key ? "ring-1 ring-[var(--accent)]" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarPicture(key)}
                  alt={`${p.label} avatar`}
                  className="h-40 w-full rounded-lg bg-white object-cover object-top"
                />
                <span className="text-[13px] leading-tight font-medium">
                  {p.label}
                </span>
                <span className="text-[10px] text-[var(--muted)]">
                  {p.gender} · voice: {p.voice}
                </span>
                <div className="mt-auto flex flex-wrap justify-center gap-1.5">
                  <button
                    className="btn !px-2 !py-1 !text-[11px]"
                    aria-label={`${playing === key ? "Stop" : "Play"} the voice of ${p.label}`}
                    onClick={() => void playOne(key)}
                  >
                    {playing === key ? "■ Stop" : "▶ Play"}
                  </button>
                  <button
                    className="btn !px-2 !py-1 !text-[11px]"
                    aria-pressed={selected}
                    disabled={selected}
                    onClick={() => {
                      stop();
                      onPick(key);
                      onClose();
                    }}
                  >
                    {selected ? "Selected" : "Use"}
                  </button>
                  {hds.map((o) => {
                    const tag = `${key}|${o.id}`;
                    return (
                      <span key={o.id} className="flex gap-1.5">
                        <button
                          className="btn !px-2 !py-1 !text-[11px]"
                          aria-label={`${playing === tag ? "Stop" : "Play"} the ${o.label} voice of ${p.label}`}
                          onClick={() => void playOne(key, o.id)}
                        >
                          {playing === tag
                            ? `■ Stop ${o.label}`
                            : `▶ ${o.label}`}
                        </button>
                        <button
                          className="btn !px-2 !py-1 !text-[11px]"
                          aria-label={`Use the ${o.label} voice for ${p.label}`}
                          onClick={() => {
                            stop();
                            onPick(key, o.id);
                            onClose();
                          }}
                        >
                          Use
                        </button>
                      </span>
                    );
                  })}{" "}
                </div>
                {failed?.split("|")[0] === key && (
                  <span className="text-[10px] text-red-300">
                    No sample available.
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
