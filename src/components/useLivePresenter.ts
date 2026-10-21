"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type LivePhase = "idle" | "connecting" | "ready" | "speaking" | "ended" | "error";

type LiveSession = {
  token: string;
  region: string;
  ice: { urls: string[]; username: string; credential: string };
};

type Synth = import("microsoft-cognitiveservices-speech-sdk").AvatarSynthesizer;

const BACKGROUND = "#1F2A37FF";

/**
 * One live avatar session in the browser. The server mints a short-lived
 * Speech token and relay credentials; the Speech SDK then streams the avatar
 * over WebRTC straight to the video and audio elements. Nothing is recorded.
 */
export function useLivePresenter(
  videoRef: RefObject<HTMLVideoElement | null>,
  audioRef: RefObject<HTMLAudioElement | null>,
) {
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const synth = useRef<Synth | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  // Bumped on every start and end so a slow async step can tell it was superseded.
  const run = useRef(0);

  const release = useCallback(async () => {
    run.current++;
    const s = synth.current;
    const p = peer.current;
    synth.current = null;
    peer.current = null;
    try {
      await s?.close();
    } catch {
      /* already closed */
    }
    p?.close();
    for (const el of [videoRef.current, audioRef.current]) if (el) el.srcObject = null;
  }, [videoRef, audioRef]);

  const end = useCallback(async () => {
    await release();
    setPhase("idle");
  }, [release]);

  useEffect(() => () => void release(), [release]);

  const start = useCallback(
    async (character: string, voice: string) => {
      await release();
      const id = ++run.current;
      setPhase("connecting");
      setError(null);
      try {
        const res = await fetch("/api/live-presenter", { method: "POST" });
        const body = (await res.json().catch(() => ({}))) as Partial<LiveSession> & {
          error?: string;
        };
        if (!res.ok || !body.token || !body.region || !body.ice) {
          throw new Error(body.error ?? "Could not start a live session.");
        }
        const SDK = await import("microsoft-cognitiveservices-speech-sdk");
        if (id !== run.current) return;

        const speech = SDK.SpeechConfig.fromAuthorizationToken(body.token, body.region);
        speech.speechSynthesisVoiceName = voice;
        const avatar = new SDK.AvatarConfig(character, "", new SDK.AvatarVideoFormat());
        avatar.photoAvatarBaseModel = "vasa-2";
        avatar.backgroundColor = BACKGROUND;

        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: body.ice.urls, username: body.ice.username, credential: body.ice.credential },
          ],
        });
        let dropTimer: ReturnType<typeof setTimeout> | undefined;
        pc.ontrack = (e) => {
          const el = e.track.kind === "video" ? videoRef.current : audioRef.current;
          if (!el) return;
          el.srcObject = e.streams[0];
          void el.play().catch(() => undefined);
        };
        pc.oniceconnectionstatechange = () => {
          clearTimeout(dropTimer);
          const state = pc.iceConnectionState;
          if (state === "failed" || state === "closed") {
            if (id === run.current) void release().then(() => setPhase("ended"));
          } else if (state === "disconnected") {
            // Brief network blips recover on their own; a lasting one ends the session.
            dropTimer = setTimeout(() => {
              if (id === run.current && pc.iceConnectionState === "disconnected") {
                void release().then(() => setPhase("ended"));
              }
            }, 5000);
          }
        };
        pc.addTransceiver("video", { direction: "sendrecv" });
        pc.addTransceiver("audio", { direction: "sendrecv" });

        const s = new SDK.AvatarSynthesizer(speech, avatar);
        peer.current = pc;
        synth.current = s;
        await s.startAvatarAsync(pc);
        if (id !== run.current) return;
        setPhase("ready");
      } catch (e) {
        if (id !== run.current) return;
        await release();
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [release, videoRef, audioRef],
  );

  const speak = useCallback(async (text: string) => {
    const s = synth.current;
    if (!s || !text.trim()) return;
    const id = run.current;
    setPhase("speaking");
    setError(null);
    try {
      const SDK = await import("microsoft-cognitiveservices-speech-sdk");
      const result = await s.speakTextAsync(text);
      if (id !== run.current) return;
      if (result.reason === SDK.ResultReason.Canceled) {
        setError(result.errorDetails || "The presenter could not speak that.");
      }
      setPhase("ready");
    } catch (e) {
      if (id !== run.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  }, []);

  const stopSpeaking = useCallback(async () => {
    try {
      await synth.current?.stopSpeakingAsync();
    } catch {
      /* nothing was playing */
    }
  }, []);

  return { phase, error, start, speak, stopSpeaking, end };
}
