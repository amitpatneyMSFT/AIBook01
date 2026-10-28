import { describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

vi.mock("@/lib/ai", () => ({
  embed: async () => [[1, 0]],
  embedModel: () => "new-model",
}));

import { db, floatsToBlob } from "@/lib/db";
import { retrieveWithDiagnostics, searchPassages } from "@/lib/retrieve";

function seed(model: string) {
  const nb = nanoid(12);
  const src = nanoid(12);
  db.prepare("INSERT INTO notebooks (id, title, emoji, created_at) VALUES (?,?,?,?)").run(nb, "T", "📓", 1);
  db.prepare(
    "INSERT INTO sources (id, notebook_id, title, kind, url, text, chars, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(src, nb, "S", "text", null, "t", 1, 1);
  db.prepare(
    `INSERT INTO chunks (id, source_id, notebook_id, idx, text, embedding, embed_model, embed_dims)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(nanoid(12), src, nb, 0, "Trees have leaves", floatsToBlob([1, 0]), model, 2);
  return nb;
}

describe("embedding model identity", () => {
  it("does not compare vectors from another model even when dimensions match", async () => {
    const nb = seed("old-model");
    const { passages, mismatch } = await retrieveWithDiagnostics(nb, "unrelated", undefined);
    expect(mismatch).toMatchObject({ staleChunks: 1, models: ["old-model"], currentModel: "new-model" });
    expect(passages[0]?.score).toBe(0);
  });

  it("uses vectors from the current model", async () => {
    const nb = seed("new-model");
    const { passages, mismatch } = await retrieveWithDiagnostics(nb, "unrelated", undefined);
    expect(mismatch).toBeNull();
    expect(passages[0]?.score).toBeGreaterThan(0.8);
  });

  it("ranks other-model chunks by keywords in cross-notebook search", async () => {
    const nb = seed("old-model");
    const stale = await searchPassages("leaves", { mode: "vector", notebookId: nb });
    expect(stale.hits[0]?.score).toBe(1);
    const unrelated = await searchPassages("zzz", { mode: "vector", notebookId: nb });
    expect(unrelated.hits).toHaveLength(0);
  });
});
