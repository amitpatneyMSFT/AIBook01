"use client";

import { useEffect, useRef, useState } from "react";
import { AVATAR_PRESETS, LIVE_PRESENTERS, avatarPicture } from "@/lib/avatars";
import { PINNED_VOICES } from "@/lib/voices";
import { useDialog } from "./useDialog";
import { useLivePresenter } from "./useLivePresenter";

const MAX_CHARS = 1000;

type Status = { ready: boolean; region?: string; problem?: string };

export default function LivePresenterModal({ onClose }: { onClose: () => void }) {
  const { dialogRef, backdropProps } = useDialog(onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const live = useLivePresenter(videoRef, audioRef);
  const [status, setStatus] = useState<Status | null>(null);
  const [key, setKey] = useState(LIVE_PRESENTERS[0][0]);
  const [voice, setVoice] = useState(AVATAR_PRESETS[LIVE_PRESENTERS[0][0]].voice);
  const [text, setText] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/live-presenter")
      .then((r) => r.json() as Promise<Status>)
      .then((s) => alive && setStatus(s))
      .catch(
        () => alive && setStatus({ ready: false, problem: "Could not check the live presenter." }),
      );
    return () => {
      alive = false;
    };
  }, []);

  const preset = AVATAR_PRESETS[key];
  const connected = live.phase === "ready" || live.phase === "speaking";
  const busy = live.phase === "connecting";

  const pick = (k: string) => {
    setKey(k);
    setVoice(AVATAR_PRESETS[k].voice);
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
        aria-labelledby="live-title"
        className="fade-up card flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden !p-0 outline-none"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id="live-title" className="text-[15px] font-semibold">
              Live presenter
            </h2>
            <p className="text-[11px] text-[var(--muted)]">
              A VASA-2 talking head (preview) that speaks what you type, live. Nothing is recorded
              or saved, and it is billed per minute while connected.
            </p>
          </div>
          <button aria-label="Close" className="btn !px-2.5 !py-1.5 !text-xs" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {status && !status.ready && (
            <p
              role="alert"
              className="rounded-xl border border-[var(--border)] px-3 py-2 text-[13px] leading-snug text-red-300"
            >
              {status.problem}
            </p>
          )}

          <div
            role="radiogroup"
            aria-label="Presenter"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {LIVE_PRESENTERS.map(([k, p]) => (
              <button
                key={k}
                role="radio"
                aria-checked={key === k}
                disabled={connected || busy}
                onClick={() => pick(k)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center disabled:opacity-60 ${
                  key === k ? "border-[var(--accent)] bg-well" : "border-[var(--border)]"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={avatarPicture(k)}
                  alt=""
                  className="h-20 w-20 rounded-lg bg-white object-cover object-top"
                />
                <span className="text-[13px] leading-tight font-medium">
                  {p.label.split(" · ")[0]}
                </span>
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
            <span className="w-11 shrink-0 tracking-wide uppercase">Voice</span>
            <select
              className="min-w-0 flex-1 cursor-pointer rounded-md border border-[var(--border)] bg-well px-2 py-1 text-[11px] text-[var(--fg)] outline-none focus:border-focus"
              aria-label="Presenter voice"
              value={voice}
              disabled={connected || busy}
              onChange={(e) => setVoice(e.target.value)}
            >
              {Object.keys(PINNED_VOICES).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>

          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-[#1F2A37]">
            <video
              ref={videoRef}
              className="h-full w-full object-contain"
              autoPlay
              playsInline
              muted
              aria-label={`${preset.label} live video`}
            />
            <audio ref={audioRef} autoPlay />
            {!connected && (
              <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[var(--muted)]">
                {busy
                  ? "Connecting…"
                  : live.phase === "ended"
                    ? "The session ended. Start a new one to continue."
                    : "Start a session to see the presenter."}
              </div>
            )}
          </div>

          <textarea
            className="min-h-24 w-full resize-y rounded-xl border border-[var(--border)] bg-well p-3 text-[13px] text-[var(--fg)] outline-none focus:border-focus"
            aria-label="What the presenter should say"
            placeholder="Type what the presenter should say…"
            maxLength={MAX_CHARS}
            value={text}
            disabled={!connected}
            onChange={(e) => setText(e.target.value)}
          />

          {live.error && (
            <p role="alert" className="text-[13px] leading-snug text-red-300">
              {live.error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!connected ? (
              <button
                className="btn btn-primary"
                disabled={!status?.ready || busy}
                onClick={() => void live.start(preset.character, PINNED_VOICES[voice] ?? voice)}
              >
                {busy ? "Connecting…" : "Start session"}
              </button>
            ) : (
              <>
                <button
                  className="btn btn-primary"
                  disabled={live.phase === "speaking" || !text.trim()}
                  onClick={() => void live.speak(text)}
                >
                  Speak
                </button>
                <button
                  className="btn"
                  disabled={live.phase !== "speaking"}
                  onClick={() => void live.stopSpeaking()}
                >
                  Stop speaking
                </button>
                <button className="btn" onClick={() => void live.end()}>
                  End session
                </button>
              </>
            )}
            <span className="ml-auto text-[10px] text-[var(--muted)]">
              {text.length}/{MAX_CHARS} · sessions end after 5 idle minutes or 30 minutes total
              {status?.region ? ` · ${status.region}` : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
