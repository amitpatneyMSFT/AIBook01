"use client";

import { trainingRequest } from "@/lib/trainingrequest";

import { useState } from "react";
import {
  CUE_KINDS,
  CUE_KIND_LABELS,
  CUE_TRANSITIONS,
  LAYOUTS,
  LAYOUT_LABELS,
  MAX_BULLETS,
  TEXT_PICTURE_KINDS,
  TRANSITION_LABELS,
  findAnchor,
  type CueKind,
  type TrainingBullet,
  type TrainingCue,
  type TrainingLayout,
} from "@/lib/trainingvisuals";
import { captureUnsupportedReason } from "./useScreenCapture";
import { captureScreenPng, fileToPng } from "./trainingRaster";

const inputCls =
  "w-full rounded-md border border-[var(--border)] bg-well px-2.5 py-1.5 text-[13px] text-[var(--fg)] outline-none placeholder:text-faint focus:border-focus disabled:opacity-60";
const labelCls = "mb-1 block text-[10px] tracking-wide text-[var(--muted)] uppercase";

export function anchorStatus(text: string, anchor: string | undefined): "exact" | "approx" | "missing" {
  if (!anchor?.trim()) return "missing";
  const m = findAnchor(text, anchor);
  return m ? (m.exact ? "exact" : "approx") : "missing";
}

function Status({ status }: { status: "exact" | "approx" | "missing" }) {
  return (
    <span
      className={`text-[10px] ${
        status === "exact" ? "text-emerald-300" : status === "approx" ? "text-amber-200" : "text-red-300"
      }`}
    >
      {status === "exact"
        ? "Found in the script"
        : status === "approx"
          ? "Close match in the script"
          : "Not in the script — placed by order"}
    </span>
  );
}

export default function TrainingCueEditor({
  artifactId,
  cue,
  sectionText,
  selection,
  infographics,
  disabled,
  onChange,
  onRemove,
}: {
  artifactId: string;
  cue: TrainingCue;
  sectionText: string;
  /** Text the user has selected in the section, offered as an anchor. */
  selection: string;
  infographics: { id: string; title: string }[];
  disabled: boolean;
  /** Merged into the latest copy of this cue, so a slow upload cannot undo other edits. */
  onChange: (patch: Partial<TrainingCue>) => void;
  onRemove: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = onChange;
  const bullets = cue.bullets ?? [];
  const setBullet = (i: number, patch: Partial<TrainingBullet>) =>
    set({ bullets: bullets.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  const upload = async (dataUrl: string) => {
    const res = await fetch(`/api/training/${artifactId}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    const j = (await res.json().catch(() => ({}))) as { imageId?: string; error?: string };
    if (!res.ok || !j.imageId) throw new Error(j.error || "Could not save the picture.");
    set({ imageId: j.imageId, imageCredit: undefined, imageSource: undefined });
  };

  const act = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (e) {
      // A cancelled screen share is not an error worth showing.
      if (!(e instanceof DOMException && e.name === "NotAllowedError")) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      setBusy(null);
    }
  };

  const generate = () =>
    act("generate", async () => {
      const res = await fetch(`/api/training/${artifactId}/assets/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: cue.imagePrompt }),
      });
      const j = (await res.json().catch(() => ({}))) as { imageId?: string; error?: string };
      if (!res.ok || !j.imageId) throw new Error(j.error || "Could not draw the picture.");
      set({ imageId: j.imageId, imageCredit: undefined, imageSource: undefined });
    });

  const findShot = () =>
    act("find", async () => {
      const j = await trainingRequest<{ imageId?: string; credit?: string; source?: string; error?: string }>(
        `/api/training/${artifactId}/assets/find`,
        "Finding a screenshot",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: cue.imageQuery, exclude: cue.imageSource ? [cue.imageSource] : [] }),
        },
      );
      if (!j.imageId) throw new Error("Could not find a screenshot.");
      set({ imageId: j.imageId, imageCredit: j.credit, imageSource: j.source });
    });

  const locked = disabled || busy !== null;
  const anchor = anchorStatus(sectionText, cue.anchor);
  const pictureKind = cue.kind === "image" || cue.kind === "screenshot";
  const textPicture = TEXT_PICTURE_KINDS.includes(cue.kind);

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label>
          <span className={labelCls}>Visual</span>
          <select
            className={inputCls}
            value={cue.kind}
            disabled={locked}
            onChange={(e) => {
              const kind = e.target.value as CueKind;
              set({ kind, layout: kind === "presenter" ? "presenter" : cue.layout === "presenter" ? "side-left" : cue.layout });
            }}
          >
            {CUE_KINDS.map((k) => (
              <option key={k} value={k}>
                {CUE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>Layout</span>
          <select
            className={inputCls}
            value={cue.layout}
            disabled={locked || cue.kind === "presenter"}
            onChange={(e) => set({ layout: e.target.value as TrainingLayout })}
          >
            {LAYOUTS.filter((l) => (cue.kind === "presenter" ? l === "presenter" : l !== "presenter")).map((l) => (
              <option key={l} value={l}>
                {LAYOUT_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className={labelCls}>Arrives with</span>
          <select
            className={inputCls}
            value={cue.transition}
            disabled={locked || cue.kind === "presenter"}
            onChange={(e) => set({ transition: e.target.value as TrainingCue["transition"] })}
          >
            {CUE_TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <label className="block">
          <span className={labelCls}>Appears when the presenter says</span>
          <div className="flex gap-2">
            <input
              className={inputCls}
              value={cue.anchor}
              disabled={locked}
              placeholder="A few words from this section"
              onChange={(e) => set({ anchor: e.target.value })}
            />
            <input
              type="number"
              step={0.5}
              min={-10}
              max={10}
              className={`${inputCls} !w-20`}
              value={cue.offsetSec ?? 0}
              disabled={locked}
              onChange={(e) => set({ offsetSec: Number(e.target.value) || undefined })}
              aria-label="Shift in seconds"
              title="Shift in seconds: negative appears earlier"
            />
          </div>
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Status status={anchor} />
          {selection && selection !== cue.anchor && (
            <button className="btn !px-2 !py-0.5 !text-[10px]" disabled={locked} onClick={() => set({ anchor: selection })}>
              Use selected words
            </button>
          )}
        </div>
      </div>

      {cue.kind !== "presenter" && cue.kind !== "stat" && cue.kind !== "quote" && cue.kind !== "check" && (
        <label className="block">
          <span className={labelCls}>{pictureKind ? "Title (optional)" : "Title"}</span>
          <input className={inputCls} value={cue.title ?? ""} disabled={locked} onChange={(e) => set({ title: e.target.value })} />
        </label>
      )}
      {cue.kind === "title" && (
        <label className="block">
          <span className={labelCls}>Subtitle</span>
          <input className={inputCls} value={cue.subtitle ?? ""} disabled={locked} onChange={(e) => set({ subtitle: e.target.value })} />
        </label>
      )}

      {(cue.kind === "bullets" || cue.kind === "objectives") && (
        <div className="space-y-1.5">
          <span className={labelCls}>
            {cue.kind === "objectives" && !bullets.length
              ? "Points · empty uses the learning objectives"
              : "Points · each revealed when its words are spoken"}
          </span>
          {bullets.map((b, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={inputCls}
                value={b.text}
                disabled={locked}
                placeholder={`Point ${i + 1}`}
                onChange={(e) => setBullet(i, { text: e.target.value })}
                aria-label={`Point ${i + 1}`}
              />
              <input
                className={`${inputCls} ${b.anchor && anchorStatus(sectionText, b.anchor) === "missing" ? "!border-red-400/60" : ""}`}
                value={b.anchor ?? ""}
                disabled={locked}
                placeholder="Revealed at… (optional)"
                onChange={(e) => setBullet(i, { anchor: e.target.value || undefined })}
                aria-label={`Point ${i + 1} revealed at`}
              />
              <button
                className="btn !px-2 !py-1 !text-xs hover:text-red-300"
                disabled={locked}
                onClick={() => set({ bullets: bullets.filter((_, j) => j !== i) })}
                aria-label={`Remove point ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
          {bullets.length < MAX_BULLETS && (
            <button
              className="btn !text-[11px]"
              disabled={locked}
              onClick={() => set({ bullets: [...bullets, { text: "", ...(selection ? { anchor: selection } : {}) }] })}
            >
              + Add point{selection ? " at selected words" : ""}
            </button>
          )}
        </div>
      )}

      {cue.kind === "stat" && (
        <div className="grid grid-cols-3 gap-2">
          <label>
            <span className={labelCls}>Number</span>
            <input
              className={inputCls}
              value={cue.stat?.value ?? ""}
              disabled={locked}
              onChange={(e) => set({ stat: { value: e.target.value, label: cue.stat?.label ?? "" } })}
            />
          </label>
          <label className="col-span-2">
            <span className={labelCls}>Meaning</span>
            <input
              className={inputCls}
              value={cue.stat?.label ?? ""}
              disabled={locked}
              onChange={(e) => set({ stat: { value: cue.stat?.value ?? "", label: e.target.value } })}
            />
          </label>
        </div>
      )}

      {cue.kind === "quote" && (
        <div className="space-y-2">
          <label className="block">
            <span className={labelCls}>Quote</span>
            <textarea
              className={`${inputCls} min-h-[3.5rem]`}
              value={cue.quote?.text ?? ""}
              disabled={locked}
              onChange={(e) => set({ quote: { ...cue.quote, text: e.target.value } })}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Attribution (optional)</span>
            <input
              className={inputCls}
              value={cue.quote?.attribution ?? ""}
              disabled={locked}
              onChange={(e) => set({ quote: { text: cue.quote?.text ?? "", attribution: e.target.value } })}
            />
          </label>
        </div>
      )}

      {cue.kind === "check" && (
        <div className="space-y-2">
          <label className="block">
            <span className={labelCls}>Question</span>
            <input className={inputCls} value={cue.question ?? ""} disabled={locked} onChange={(e) => set({ question: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Answer</span>
            <input className={inputCls} value={cue.answer ?? ""} disabled={locked} onChange={(e) => set({ answer: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Answer revealed when the presenter says</span>
            <div className="flex gap-2">
              <input
                className={inputCls}
                value={cue.answerAnchor ?? ""}
                disabled={locked}
                onChange={(e) => set({ answerAnchor: e.target.value || undefined })}
              />
              {selection && (
                <button className="btn shrink-0 !px-2 !py-0.5 !text-[10px]" disabled={locked} onClick={() => set({ answerAnchor: selection })}>
                  Use selection
                </button>
              )}
            </div>
          </label>
        </div>
      )}

      {cue.kind === "infographic" && (
        <label className="block">
          <span className={labelCls}>Infographic</span>
          <select
            className={inputCls}
            value={cue.infographicId ?? ""}
            disabled={locked}
            onChange={(e) => set({ infographicId: e.target.value || undefined })}
          >
            <option value="">{infographics.length ? "Choose one of this notebook's infographics" : "This notebook has no infographics yet"}</option>
            {infographics.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
      )}

      {(pictureKind || textPicture) && (
        <div className="space-y-2">
          {textPicture && (
            <span className={labelCls}>Picture beside the words · optional</span>
          )}
          {cue.kind !== "screenshot" && (
            <label className="block">
              <span className={labelCls}>Microsoft Learn screenshot search</span>
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  value={cue.imageQuery ?? ""}
                  disabled={locked}
                  placeholder="For example: create agent Copilot Studio portal"
                  onChange={(e) => set({ imageQuery: e.target.value || undefined })}
                />
                <button
                  className="btn shrink-0 !text-[11px]"
                  disabled={locked || !cue.imageQuery?.trim()}
                  onClick={() => void findShot()}
                >
                  {busy === "find" ? "Searching…" : cue.imageCredit ? "Find another" : "Find screenshot"}
                </button>
              </div>
            </label>
          )}
          {cue.kind !== "screenshot" && (
            <label className="block">
              <span className={labelCls}>{textPicture ? "Or describe a picture to draw" : "Describe the picture"}</span>
              <textarea
                className={`${inputCls} min-h-[3.5rem]`}
                value={cue.imagePrompt ?? ""}
                disabled={locked}
                onChange={(e) => set({ imagePrompt: e.target.value || undefined })}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {cue.kind !== "screenshot" && (
              <button className="btn !text-[11px]" disabled={locked || !cue.imagePrompt?.trim()} onClick={() => void generate()}>
                {busy === "generate" ? "Drawing…" : cue.imageId && !cue.imageCredit ? "Draw again" : "Generate picture"}
              </button>
            )}
            <label className={`btn !text-[11px] ${locked ? "pointer-events-none opacity-50" : "cursor-pointer"}`}>
              {busy === "upload" ? "Uploading…" : "Upload picture"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={locked}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void act("upload", async () => upload(await fileToPng(f)));
                }}
              />
            </label>
            {cue.kind === "screenshot" && (
              <button
                className="btn !text-[11px]"
                disabled={locked}
                onClick={() =>
                  void act("capture", async () => {
                    const why = captureUnsupportedReason();
                    if (why) throw new Error(why);
                    await upload(await captureScreenPng());
                  })
                }
              >
                {busy === "capture" ? "Capturing…" : "Capture screen"}
              </button>
            )}
            <div
              tabIndex={0}
              className="rounded-md border border-dashed border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)] outline-none focus:border-focus"
              onPaste={(e) => {
                const f = [...e.clipboardData.files].find((x) => x.type.startsWith("image/"));
                if (!f || locked) return;
                e.preventDefault();
                void act("upload", async () => upload(await fileToPng(f)));
              }}
            >
              Click here, then paste an image
            </div>
          </div>
          {cue.imageId && (
            <div className="flex flex-wrap items-end gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/image/${cue.imageId}`}
                alt={cue.caption || "Picture for this visual"}
                className="max-h-32 rounded-md border border-[var(--border)]"
              />
              <div className="space-y-1">
                {cue.imageCredit && (
                  <p className="text-[10px] text-[var(--muted)]">
                    From{" "}
                    {cue.imageSource ? (
                      <a className="underline" href={cue.imageSource} target="_blank" rel="noreferrer">
                        {cue.imageCredit}
                      </a>
                    ) : (
                      cue.imageCredit
                    )}
                  </p>
                )}
                {textPicture && (
                  <button
                    className="btn !px-2 !py-0.5 !text-[10px] hover:text-red-300"
                    disabled={locked}
                    onClick={() => set({ imageId: undefined, imageCredit: undefined, imageSource: undefined })}
                  >
                    Remove picture
                  </button>
                )}
              </div>
            </div>
          )}
          {pictureKind && (
            <>
              <label className="block">
                <span className={labelCls}>Caption (optional)</span>
                <input className={inputCls} value={cue.caption ?? ""} disabled={locked} onChange={(e) => set({ caption: e.target.value })} />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                <input
                  type="checkbox"
                  checked={cue.kenBurns !== false}
                  disabled={locked}
                  onChange={(e) => set({ kenBurns: e.target.checked })}
                />
                Slow push-in while on screen
              </label>
            </>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-300">{error}</p>}
      <div className="flex justify-end">
        <button className="btn !px-2 !py-1 !text-[11px] hover:text-red-300" disabled={locked} onClick={onRemove}>
          Remove visual
        </button>
      </div>
    </div>
  );
}
