import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingContent } from "@/lib/types";
import { prepareRasters } from "@/components/trainingRaster";

const mocks = vi.hoisted(() => ({
  toPng: vi.fn(),
  getFontEmbedCSS: vi.fn(),
  root: { render: vi.fn(), unmount: vi.fn() },
}));
vi.mock("html-to-image", () => ({
  toPng: mocks.toPng,
  getFontEmbedCSS: mocks.getFontEmbedCSS,
}));
vi.mock("react-dom/client", () => ({ createRoot: () => mocks.root }));
vi.mock("react-dom", () => ({ flushSync: (render: () => void) => render() }));
vi.mock("@/components/TrainingVisual", () => ({ default: () => null }));
vi.mock("@/lib/trainingtimeline", () => ({
  composeInputOf: () => ({}),
  composeVocabulary: () => new Map(),
  rasterJobs: () => [{ key: "visual-key", section: 0, role: "title", width: 100, height: 100 }],
}));

const content: TrainingContent = {
  title: "Test training",
  objectives: [],
  sections: [{ title: "Welcome", text: "Welcome to training." }],
  presenter: "lisa",
  voice: "en-US-AvaMultilingualNeural",
  background: "#ffffff",
  progress: { stage: "transcript" },
};
const host = {
  setAttribute: vi.fn(),
  style: { cssText: "" },
  firstElementChild: {},
  querySelectorAll: () => [],
  remove: vi.fn(),
};
const json = (body: unknown) => new Response(JSON.stringify(body));
const prepare = () => prepareRasters({ artifactId: "video-123", content, infographics: new Map() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("document", {
    hidden: false,
    createElement: () => host,
    body: { appendChild: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    fonts: { ready: Promise.resolve() },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
  mocks.getFontEmbedCSS.mockResolvedValue("");
  mocks.toPng.mockResolvedValue("data:image/png;base64,test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("render visual preparation", () => {
  it("explains a capture failure before any raster upload or render submission", async () => {
    const cause = new TypeError("Failed to fetch");
    mocks.toPng.mockRejectedValue(cause);
    const fetch = vi.fn().mockResolvedValue(json({ missing: [{ key: "visual-key", state: 0 }] }));
    vi.stubGlobal("fetch", fetch);
    await expect(prepare()).rejects.toThrow(/Drawing visual 1 of 1.*section 1.*Failed to fetch.*render has not been submitted/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[training] visual capture failed",
      expect.objectContaining({ artifactId: "video-123", key: "visual-key", state: 0, section: 0 }), cause);
    expect(mocks.root.unmount).toHaveBeenCalledOnce();
    expect(host.remove).toHaveBeenCalledOnce();
  });

  it("identifies which upload failed and cleans up the off-screen renderer", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ missing: [{ key: "visual-key", state: 0 }] }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    await expect(prepare()).rejects.toThrow(/Uploading visual 1 of 1.*visual-key.*PUT.*no HTTP response/);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.root.unmount).toHaveBeenCalledOnce();
    expect(host.remove).toHaveBeenCalledOnce();
  });

  it("draws and uploads missing visuals successfully", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json({ missing: [{ key: "visual-key", state: 0 }] }))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(prepare()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenLastCalledWith("/api/training/video-123/raster", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "visual-key", state: 0, dataUrl: "data:image/png;base64,test" }),
    });
  });

  it("does not mistake a malformed raster response for a fully cached video", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({})));
    await expect(prepare()).rejects.toThrow("The server did not return the list of missing visuals.");
    expect(mocks.root.render).not.toHaveBeenCalled();
  });
});
