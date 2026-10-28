import { afterEach, describe, expect, it, vi } from "vitest";
import { trainingRequest, TrainingRequestError } from "@/lib/trainingrequest";
import { keepAliveJSON } from "@/lib/keepalive";

const url = "/api/training/video-123/render";
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("trainingRequest", () => {
  it("returns successful replies without retrying a potentially billable request", async () => {
    const fetch = vi.fn().mockResolvedValue(reply({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(trainingRequest(url, "Starting the render", { method: "POST" }))
      .resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, { method: "POST" });
  });

  it("identifies the step and endpoint when the browser has no HTTP response", async () => {
    const cause = new TypeError("Failed to fetch");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(cause));
    const error = await trainingRequest(url, "Starting the render", { method: "POST" }).catch((e) => e);
    expect(error).toBeInstanceOf(TrainingRequestError);
    expect(error.message).toContain(`Starting the render failed (POST ${url}; no HTTP response)`);
    expect(error.message).toContain("check the video's progress before trying again");
    expect(error.cause).toBe(cause);
    expect(log).toHaveBeenCalledWith("[training] request failed",
      expect.objectContaining({ step: "Starting the render", method: "POST", url, status: "no HTTP response" }), cause);
  });

  it("preserves server error details and HTTP status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ error: "Speech access denied" }, 403)));
    await expect(trainingRequest(url, "Starting the render", { method: "POST" }))
      .rejects.toMatchObject({ status: 403, message: expect.stringContaining("HTTP 403): Speech access denied") });
  });

  it("keeps a no-picture response distinguishable from a transport failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ error: "No picture found" }, 404)));
    await expect(trainingRequest("/api/training/video-123/assets/find", "Finding picture 1 of 2"))
      .rejects.toMatchObject({ status: 404 });
  });

  it("explains a proxy timeout rather than discarding its response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("stream timeout", { status: 504 })));
    await expect(trainingRequest(url, "Starting the render", { method: "POST" }))
      .rejects.toThrow(/HTTP 504.*took too long/);
  });

  it("reports an interrupted response body as a failure, not a successful submission", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("terminated")); },
    }))));
    await expect(trainingRequest(url, "Starting the render", { method: "POST" }))
      .rejects.toThrow(/HTTP 200.*terminated/);
  });

  it("rejects a streamed failure even after keep-alive committed HTTP 200", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await keepAliveJSON(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return reply({ error: "Speech unavailable" }, 502);
    }, { graceMs: 1, intervalMs: 5 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(trainingRequest(url, "Starting the render", { method: "POST" }))
      .rejects.toThrow("Speech unavailable");
  });

  it("preserves a late no-picture status so rendering can continue with words only", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await keepAliveJSON(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return reply({ error: "No picture found" }, 404);
    }, { graceMs: 1 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(trainingRequest("/api/training/video-123/assets/find", "Finding picture 1 of 2"))
      .rejects.toMatchObject({ status: 404 });
  });
});
