import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import VideoPlayer from "@/components/VideoPlayer";

const draw = (variant: "whiteboard" | "motion", progress: { stage: string; done: number; total: number }) =>
  renderToStaticMarkup(
    <VideoPlayer
      artifactId="t"
      variant={variant}
      onRefresh={() => {}}
      content={{ title: "Video", scenes: [], progress }}
    />,
  );

describe("VideoPlayer progress", () => {
  it("shows the rendering stage as a percent with an accessible bar", () => {
    const html = draw("motion", { stage: "rendering", done: 42, total: 100 });
    expect(html).toContain("42%");
    expect(html).toMatch(/role="progressbar"[^>]*aria-label="Animating the video"[^>]*aria-valuenow="42"/);
    // The earlier stages are finished.
    expect(html.match(/>done</g)).toHaveLength(2);
  });

  it("counts artwork and narration in items, not percent", () => {
    const html = draw("motion", { stage: "artwork", done: 7, total: 14 });
    expect(html).toContain("7/14");
    expect(html).not.toContain(">50%<");
    expect(draw("whiteboard", { stage: "narration", done: 2, total: 5 })).toContain("2/5");
  });

  it("shows nothing for a render that cannot say how far along it is", () => {
    const html = draw("whiteboard", { stage: "rendering", done: 0, total: 1 });
    expect(html).not.toContain("0/1");
    expect(html).not.toContain("0%</span>");
  });
});
