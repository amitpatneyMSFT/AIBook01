import { describe, expect, it } from "vitest";
import { liveChunks } from "@/lib/livescript";

describe("live presenter transcript chunks", () => {
  it("splits sections into paragraphs and tags each with its section", () => {
    const chunks = liveChunks([
      { text: "Welcome.\n\nToday we cover beds." },
      { text: "Drip kits save water." },
    ]);
    expect(chunks).toEqual([
      { section: 0, text: "Welcome." },
      { section: 0, text: "Today we cover beds." },
      { section: 1, text: "Drip kits save water." },
    ]);
  });

  it("keeps pieces under the limit and never loses words", () => {
    const sentence = "A drip kit costs six hundred forty dollars.";
    const text = Array(30).fill(sentence).join(" ");
    const chunks = liveChunks([{ text }], 200);
    expect(chunks.every((c) => c.text.length <= 200)).toBe(true);
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });

  it("cuts a stop-less run at word boundaries", () => {
    const text = Array(100).fill("word").join(" ");
    const chunks = liveChunks([{ text }], 50);
    expect(chunks.every((c) => c.text.length <= 50)).toBe(true);
    expect(chunks.map((c) => c.text).join(" ")).toBe(text);
  });

  it("skips empty sections", () => {
    expect(liveChunks([{ text: "  \n\n " }, { text: "Hi." }])).toEqual([
      { section: 1, text: "Hi." },
    ]);
  });
});
