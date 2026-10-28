"use client";

import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import TrainingVisual from "./TrainingVisual";
import type { InfographicContent, TrainingContent } from "@/lib/types";
import { compositionPalette, normalizeComposition } from "@/lib/trainingvisuals";
import { rasterJobs, composeInputOf, composeVocabulary, type RasterJob } from "@/lib/trainingtimeline";
import type { CaseVocabulary } from "@/lib/slidecase";
import { trainingRequest } from "@/lib/trainingrequest";

/**
 * Draw every visual the compositor still needs and upload it as a PNG.
 *
 * Runs in the browser because the visuals are React components — the same
 * ones the preview shows — and infographics only exist as components. Each
 * one is mounted off screen at its exact pixel size, given a moment for
 * pictures and fonts, then captured with html-to-image.
 */

// Browsers never fire animation frames in a hidden tab, and throttle timers hard,
// so a plain requestAnimationFrame wait would freeze drawing until the user comes
// back. A message-channel tick is not throttled; hidden tabs do not paint anyway.
const tick = () =>
  new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (document.hidden) return void tick().then(resolve);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      document.removeEventListener("visibilitychange", onHide);
      resolve();
    };
    const onHide = () => {
      if (document.hidden) void tick().then(finish);
    };
    document.addEventListener("visibilitychange", onHide);
    requestAnimationFrame(finish);
  });

const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await nextFrame();
};

async function settle(host: HTMLElement) {
  await frames(2);
  await Promise.all(
    [...host.querySelectorAll("img")].map((img) =>
      img.complete
        ? img.decode().catch(() => {})
        : new Promise<void>((r) => {
            img.addEventListener("load", () => r(), { once: true });
            img.addEventListener("error", () => r(), { once: true });
          })
    )
  );
  await document.fonts.ready;
  await frames(1);
}

export function visualContext(
  c: TrainingContent,
  job: Pick<RasterJob, "section">,
  vocab: CaseVocabulary = composeVocabulary(composeInputOf(c))
) {
  const comp = normalizeComposition(c.composition);
  const s = job.section !== undefined ? c.sections[job.section] : undefined;
  return {
    title: c.title,
    description: c.description,
    objectives: c.objectives ?? [],
    sectionTitle: s?.title,
    sectionIndex: job.section,
    sectionCount: c.sections.length,
    lowerName: comp.lowerThird.name,
    lowerRole: comp.lowerThird.role,
    vocab,
  };
}

export async function prepareRasters(opts: {
  artifactId: string;
  content: TrainingContent;
  infographics: Map<string, InfographicContent>;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  const { artifactId, content, infographics } = opts;
  const j = await trainingRequest<{ missing?: { key: string; state: number }[]; error?: string }>(
    `/api/training/${artifactId}/raster`, "Checking which visuals need drawing",
  );
  if (!Array.isArray(j.missing)) throw new Error("The server did not return the list of missing visuals.");
  const missing = j.missing;
  if (!missing.length) return;

  const jobs = rasterJobs(composeInputOf(content));
  const vocab = composeVocabulary(composeInputOf(content));
  const palette = compositionPalette(normalizeComposition(content.composition));
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-30000px;top:0;pointer-events:none;contain:layout paint;";
  document.body.appendChild(host);
  const root = createRoot(host);
  let fontEmbedCSS: string | undefined;

  try {
    const { toPng, getFontEmbedCSS } = await import("html-to-image");
    let done = 0;
    opts.onProgress?.(0, missing.length);
    for (const m of missing) {
      const job = jobs.find((x) => x.key === m.key);
      if (!job) continue;
      const cue =
        job.cueId !== undefined && job.section !== undefined
          ? content.sections[job.section]?.cues?.find((q) => q.id === job.cueId)
          : undefined;
      flushSync(() =>
        root.render(
          <TrainingVisual
            role={job.role}
            width={job.width}
            height={job.height}
            state={m.state}
            palette={palette}
            cue={cue}
            ctx={visualContext(content, job, vocab)}
            infographic={cue?.infographicId ? infographics.get(cue.infographicId) ?? null : null}
          />
        )
      );
      await settle(host);
      const node = host.firstElementChild as HTMLElement | null;
      if (!node) throw new Error("A visual did not render.");
      fontEmbedCSS ??= await getFontEmbedCSS(node).catch(() => "");
      let dataUrl: string;
      try {
        dataUrl = await toPng(node, {
          width: job.width,
          height: job.height,
          pixelRatio: 1,
          fontEmbedCSS,
          skipFonts: !fontEmbedCSS,
        });
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : "Unknown error";
        console.error("[training] visual capture failed", {
          artifactId, key: m.key, state: m.state, section: job.section, cueId: job.cueId,
        }, cause);
        throw new Error(
          `Drawing visual ${done + 1} of ${missing.length} (${job.role}, ${
            job.section === undefined ? "video-level" : `section ${job.section + 1}`
          }, key ${m.key}, state ${m.state}) failed: ${detail}. An image or font may not have loaded; check the browser Console. The render has not been submitted.`,
          { cause },
        );
      }
      await trainingRequest<{ error?: string }>(
        `/api/training/${artifactId}/raster`,
        `Uploading visual ${done + 1} of ${missing.length} (key ${m.key}, state ${m.state})`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key: m.key, state: m.state, dataUrl }),
        },
      );
      opts.onProgress?.(++done, missing.length);
    }
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Draw a picture file (any format the browser reads) as a PNG data URL, capped in size. */
export async function fileToPng(file: Blob, maxSide = 2560): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * s));
  canvas.height = Math.max(1, Math.round(bitmap.height * s));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

/**
 * One still of a shared screen, window or tab, as a PNG data URL. Sharing
 * stops as soon as the frame is taken; nothing is recorded.
 */
export async function captureScreenPng(maxSide = 2560): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    // The first frame of a fresh share is sometimes black; give it a beat.
    await new Promise((r) => setTimeout(r, 350));
    const s = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * s));
    canvas.height = Math.max(1, Math.round(video.videoHeight * s));
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    return canvas.toDataURL("image/png");
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}
