import { afterEach, describe, expect, it, vi } from "vitest";
import { liveStatus, startLiveSession } from "@/lib/livepresenter";
import { LIVE_PRESENTERS, PRESENTER_ENTRIES } from "@/lib/avatars";

const ENV = [
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_RESOURCE_ID",
  "AZURE_SPEECH_ENDPOINT",
  "DAILY_BUDGET_USD",
];

afterEach(() => {
  for (const k of ENV) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("live presenter status", () => {
  it("needs a Speech resource", () => {
    expect(liveStatus().ready).toBe(false);
  });

  it("needs a region", () => {
    process.env.AZURE_SPEECH_KEY = "k";
    process.env.AZURE_SPEECH_ENDPOINT = "https://x.cognitiveservices.azure.com";
    expect(liveStatus().problem).toContain("AZURE_SPEECH_REGION");
  });

  it("refuses regions without VASA-2", () => {
    process.env.AZURE_SPEECH_KEY = "k";
    process.env.AZURE_SPEECH_REGION = "eastus2";
    const s = liveStatus();
    expect(s.ready).toBe(false);
    expect(s.problem).toContain("swedencentral");
  });

  it("accepts a VASA-2 region, in any case", () => {
    process.env.AZURE_SPEECH_KEY = "k";
    process.env.AZURE_SPEECH_REGION = "SwedenCentral";
    expect(liveStatus()).toEqual({ ready: true, region: "swedencentral" });
  });
});

describe("live presenter session", () => {
  it("returns a token and turn relay with key auth, without leaking the key", async () => {
    process.env.AZURE_SPEECH_KEY = "secret-key";
    process.env.AZURE_SPEECH_REGION = "westus2";
    process.env.DAILY_BUDGET_USD = "0";
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(String(url));
        if (String(url).includes("issueToken")) return new Response("tok123");
        return Response.json({
          Urls: ["stun:relay.example:3478", "turn:relay.example:3478"],
          Username: "u",
          Password: "p",
        });
      }),
    );
    const s = await startLiveSession();
    expect(s).toEqual({
      token: "tok123",
      region: "westus2",
      ice: { urls: ["turn:relay.example:3478"], username: "u", credential: "p" },
    });
    expect(JSON.stringify(s)).not.toContain("secret-key");
    expect(seen.some((u) => u.includes("westus2.tts.speech.microsoft.com"))).toBe(true);
  });

  it("refuses to start in an unsupported region", async () => {
    process.env.AZURE_SPEECH_KEY = "k";
    process.env.AZURE_SPEECH_REGION = "eastus2";
    await expect(startLiveSession()).rejects.toThrow(/not available/);
  });
});

describe("live presenter roster", () => {
  it("offers the four VASA-2 heads live and keeps them out of batch pickers", () => {
    expect(LIVE_PRESENTERS.map(([k]) => k).sort()).toEqual([
      "head-george",
      "head-leonie",
      "head-leonie-professional",
      "head-marcel",
    ]);
    const batch = new Set(PRESENTER_ENTRIES.map(([k]) => k));
    for (const [k] of LIVE_PRESENTERS) expect(batch.has(k)).toBe(false);
  });
});
