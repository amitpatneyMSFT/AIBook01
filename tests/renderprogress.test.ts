import { describe, expect, it } from "vitest";
import { lineSplitter, parseRenderProgress, throttleProgress } from "@/lib/renderprogress";

describe("parseRenderProgress", () => {
  it("reads the renderers' frame lines", () => {
    expect(parseRenderProgress("frame 250/500")).toBe(0.5);
    expect(parseRenderProgress("  frame 0/505 ")).toBe(0);
    expect(parseRenderProgress("frame 600/500")).toBe(1);
    expect(parseRenderProgress("frame 5/0")).toBeNull();
  });

  it("reads HyperFrames' progress lines", () => {
    expect(parseRenderProgress('@hf-progress {"code":"capture","done":172,"total":180,"pct":68}')).toBe(0.68);
    expect(parseRenderProgress('@hf-progress {"pct":140}')).toBe(1);
    expect(parseRenderProgress('@hf-progress {"pct":-3}')).toBe(0);
    expect(parseRenderProgress('@hf-progress {"code":"x"}')).toBeNull();
    expect(parseRenderProgress("@hf-progress {broken")).toBeNull();
  });

  it("ignores everything else, including HyperFrames' bar", () => {
    expect(parseRenderProgress("visual failed: a.png")).toBeNull();
    expect(parseRenderProgress("  █████░░░  68%  Capturing frame 172/180 (5 workers)")).toBeNull();
    expect(parseRenderProgress("")).toBeNull();
  });
});

describe("lineSplitter", () => {
  it("hands over whole lines however the output is chunked", () => {
    const lines: string[] = [];
    const feed = lineSplitter((l) => lines.push(l));
    feed("frame 1/10\nfra");
    feed("me 2/10\r\nframe 3");
    feed("/10\rdone\n");
    expect(lines).toEqual(["frame 1/10", "frame 2/10", "frame 3/10", "done"]);
  });

  it("holds back a line that has not ended yet, until told the output is over", () => {
    const lines: string[] = [];
    const feed = lineSplitter((l) => lines.push(l));
    feed("frame 1/10");
    expect(lines).toEqual([]);
    feed.end();
    expect(lines).toEqual(["frame 1/10"]);
    feed.end();
    expect(lines).toHaveLength(1);
  });
});

describe("throttleProgress", () => {
  const harness = (minMs?: number) => {
    let clock = 0;
    const written: number[] = [];
    const report = throttleProgress((p) => written.push(p), { minMs, now: () => clock });
    return { report, written, tick: (ms: number) => (clock += ms) };
  };

  it("writes whole percents, starting at the first report", () => {
    const { report, written } = harness();
    report(0);
    expect(written).toEqual([0]);
  });

  it("writes at most once per interval and only moves forward", () => {
    const { report, written, tick } = harness(1000);
    report(0.1);
    tick(400);
    report(0.2);
    tick(700);
    report(0.3);
    tick(1000);
    report(0.25);
    report(0.3);
    tick(1000);
    report(0.4);
    expect(written).toEqual([10, 30, 40]);
  });

  it("never reports 100 and ignores nonsense", () => {
    const { report, written, tick } = harness(0);
    report(1);
    tick(10);
    report(NaN);
    report(-1);
    tick(10);
    report(2);
    expect(written).toEqual([99]);
  });
});
