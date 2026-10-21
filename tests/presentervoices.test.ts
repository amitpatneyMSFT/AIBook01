import { describe, expect, it } from "vitest";
import {
  AVATAR_PRESETS,
  DEFAULT_PRESENTER,
  PRESENTER_ENTRIES,
  avatarPicture,
  presenter,
} from "@/lib/avatars";
import {
  HD_ALTERNATES,
  hdCandidates,
  omniVoice,
  PINNED_GENDER,
  PINNED_VOICES,
} from "@/lib/voices";

describe("presenter voices", () => {
  it("knows the gender of every pinned voice", () => {
    for (const k of Object.keys(PINNED_VOICES))
      expect(PINNED_GENDER[k], k).toBeTruthy();
  });

  it("pairs every presenter with a pinned voice of the same gender", () => {
    for (const [key, p] of Object.entries(AVATAR_PRESETS)) {
      expect(PINNED_VOICES[p.voice], `${key} voice ${p.voice}`).toBeTruthy();
      expect(
        PINNED_GENDER[p.voice],
        `${key} (${p.gender}) voice ${p.voice}`,
      ).toBe(p.gender);
    }
  });

  it("has a picture for every presenter", async () => {
    const { existsSync } = await import("node:fs");
    for (const key of Object.keys(AVATAR_PRESETS)) {
      expect(existsSync(`public${avatarPicture(key)}`), key).toBe(true);
    }
  });
});

describe("HD voice candidates", () => {
  it("derives the Dragon HD Omni name for any pinned voice", () => {
    expect(omniVoice("en-US-EvelynMultilingualNeural")).toBe(
      "en-US-Evelyn:DragonHDOmniLatestNeural",
    );
    expect(omniVoice("en-US-JaneNeural")).toBe(
      "en-US-Jane:DragonHDOmniLatestNeural",
    );
  });

  it("tries DragonHD before Omni", () => {
    expect(hdCandidates("Ava")).toEqual([
      "en-US-Ava:DragonHDLatestNeural",
      "en-US-Ava:DragonHDOmniLatestNeural",
    ]);
    expect(hdCandidates("Bree")).toEqual([]);
  });
});

describe("HD alternates", () => {
  it("only offers alternates for pinned voices", () => {
    for (const k of Object.keys(HD_ALTERNATES))
      expect(PINNED_VOICES[k], k).toBeTruthy();
  });

  it("does not pin Flash voices that are limited to a few regions", () => {
    for (const id of Object.values(PINNED_VOICES))
      expect(id).not.toContain("DragonHDFlash");
  });
});

describe("presenter roster", () => {
  it("lists every standard avatar: 21 full-body and 34 talking heads", () => {
    const all = Object.values(AVATAR_PRESETS);
    expect(all.filter((p) => !p.photo)).toHaveLength(21);
    expect(all.filter((p) => p.photo)).toHaveLength(34);
  });

  it("drives four talking heads with VASA-2 and the rest with VASA-1", () => {
    const heads = Object.values(AVATAR_PRESETS).filter((p) => p.photo);
    expect(heads.filter((p) => p.photoModel === "vasa-2")).toHaveLength(4);
    expect(heads.filter((p) => !p.photoModel)).toHaveLength(30);
  });

  it("keeps VASA-2 presenters out of the pickers until batch supports them", () => {
    const offered = PRESENTER_ENTRIES.map(([, p]) => p);
    expect(offered.filter((p) => p.photoModel === "vasa-2")).toHaveLength(0);
    expect(offered.filter((p) => p.photo)).toHaveLength(30);
    expect(presenter("head-leonie").key).toBe(DEFAULT_PRESENTER);
    expect(presenter("head-adrian").key).toBe("head-adrian");
  });
});
