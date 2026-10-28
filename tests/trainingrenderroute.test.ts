import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/training/[id]/render/route";
import { AvatarNotConfiguredError } from "@/lib/avatarbatch";

const mocks = vi.hoisted(() => ({ startTrainingRender: vi.fn() }));
vi.mock("@/lib/trainingbuild", () => ({ startTrainingRender: mocks.startTrainingRender }));
vi.mock("@/lib/avatarbatch", () => ({ AvatarNotConfiguredError: class extends Error {} }));

const submit = () => POST(new Request("http://localhost/api/training/video-123/render", { method: "POST" }), {
  params: Promise.resolve({ id: "video-123" }),
});

beforeEach(() => {
  vi.useFakeTimers();
  mocks.startTrainingRender.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("training render submission route", () => {
  it("preserves successful submission", async () => {
    mocks.startTrainingRender.mockResolvedValue(undefined);
    const response = await submit();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.startTrainingRender).toHaveBeenCalledExactlyOnceWith("video-123");
  });

  it("preserves configuration errors and their error code", async () => {
    mocks.startTrainingRender.mockRejectedValue(new AvatarNotConfiguredError("Configure Speech first"));
    const response = await submit();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Configure Speech first", code: "no_config" });
  });

  it("preserves Speech permission errors rather than rewriting them as OpenAI errors", async () => {
    mocks.startTrainingRender.mockRejectedValue(Object.assign(new Error("Speech access denied"), { status: 401 }));
    const response = await submit();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Speech access denied" });
  });

  it("sends a heartbeat before a slow submission finishes, then its result", async () => {
    mocks.startTrainingRender.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 30_000)));
    const pending = submit();
    await vi.advanceTimersByTimeAsync(5_001);
    const response = await pending;
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(" ");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(" ");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(JSON.parse(new TextDecoder().decode((await reader.read()).value))).toEqual({ ok: true });
    expect((await reader.read()).done).toBe(true);
    expect(mocks.startTrainingRender).toHaveBeenCalledTimes(1);
  });

  it("preserves late submission failures after the heartbeat", async () => {
    mocks.startTrainingRender.mockImplementation(() => new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Speech unavailable")), 6_000),
    ));
    const pending = submit();
    await vi.advanceTimersByTimeAsync(5_001);
    const response = await pending;
    const body = response.json();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(response.status).toBe(200);
    expect(await body).toEqual({ error: "Speech unavailable", status: 502 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
