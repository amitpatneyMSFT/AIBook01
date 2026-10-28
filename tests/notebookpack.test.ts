import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { imageDir, imagePath, videoDir, videoPath } from "@/lib/paths";
import { exportNotebookZip, importNotebookZip } from "@/lib/notebookpack";
import { listNotes } from "@/lib/notes";
import { listSessions, sessionMessages } from "@/lib/sessions";

describe("notebook export and import", () => {
  it("round-trips sources, notes and cited chats under new ids", async () => {
    const notebookId = nanoid(12);
    const sourceId = nanoid(12);
    const sessionId = nanoid(12);
    db.prepare("INSERT INTO notebooks (id, title, emoji, created_at) VALUES (?, ?, ?, ?)").run(
      notebookId,
      "Field notes",
      "🧪",
      1
    );
    db.prepare(
      `INSERT INTO sources (id, notebook_id, title, kind, url, text, chars, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sourceId, notebookId, "Plot", "text", null, "Rain fell on Tuesday.", 22, 2);
    db.prepare(
      `INSERT INTO notes (id, notebook_id, title, content, kind, source_id, citations, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nanoid(12), notebookId, "Remember", "Check the plot.", "human", sourceId, null, 3, 3);
    db.prepare(
      `INSERT INTO chat_sessions (id, notebook_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(sessionId, notebookId, "Chat", 4, 4);
    db.prepare(
      `INSERT INTO messages (id, notebook_id, session_id, role, content, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      nanoid(12),
      notebookId,
      sessionId,
      "assistant",
      "It rained [1].",
      JSON.stringify([{ n: 1, sourceId, sourceTitle: "Plot", part: 1, snippet: "Rain fell" }]),
      5
    );

    const packed = await exportNotebookZip(notebookId);
    expect(packed?.filename).toBe("Field-notes.zip");
    db.prepare("DELETE FROM notebooks WHERE id = ?").run(notebookId);

    const imported = await importNotebookZip(packed!.buffer);
    expect(imported.title).toBe("Field notes");
    expect(imported.id).not.toBe(notebookId);

    const source = db
      .prepare("SELECT id, text FROM sources WHERE notebook_id = ?")
      .get(imported.id) as { id: string; text: string };
    expect(source.text).toBe("Rain fell on Tuesday.");
    expect(listNotes(imported.id)[0]?.content).toBe("Check the plot.");

    const session = listSessions(imported.id)[0];
    const message = sessionMessages(session.id)[0];
    expect(message.content).toBe("It rained [1].");
    expect(message.citations?.[0]?.sourceId).toBe(source.id);
    expect(message.citations?.[0]?.sourceId).not.toBe(sourceId);
  });

  it("restores media under new ids and points the saved references at them", async () => {
    const notebookId = nanoid(12);
    const videoId = nanoid(12);
    const pictureId = nanoid(12);
    db.prepare("INSERT INTO notebooks (id, title, emoji, created_at) VALUES (?, ?, ?, ?)").run(
      notebookId,
      "Media",
      "🎬",
      1
    );
    const training = {
      videoUrl: `/api/video/${videoId}?v=1`,
      captionsUrl: `/api/training/${videoId}/captions?v=1`,
      sections: [{ cues: [{ imageId: pictureId }] }],
      composition: { logoId: pictureId },
    };
    db.prepare(
      "INSERT INTO artifacts (id, notebook_id, type, title, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(videoId, notebookId, "training", "Video", JSON.stringify(training), 1);
    fs.mkdirSync(videoDir(), { recursive: true });
    fs.mkdirSync(imageDir(), { recursive: true });
    fs.writeFileSync(videoPath(videoId), "mp4");
    fs.writeFileSync(imagePath(pictureId), "png");

    const packed = await exportNotebookZip(notebookId);
    db.prepare("DELETE FROM notebooks WHERE id = ?").run(notebookId);
    const imported = await importNotebookZip(packed!.buffer);

    const row = db
      .prepare("SELECT id, content FROM artifacts WHERE notebook_id = ?")
      .get(imported.id) as { id: string; content: string };
    const content = JSON.parse(row.content);
    expect(row.id).not.toBe(videoId);
    expect(content.videoUrl).toBe(`/api/video/${row.id}?v=1`);
    expect(content.captionsUrl).toBe(`/api/training/${row.id}/captions?v=1`);
    const newPicture = content.sections[0].cues[0].imageId;
    expect(newPicture).not.toBe(pictureId);
    expect(content.composition.logoId).toBe(newPicture);
    expect(fs.existsSync(videoPath(row.id))).toBe(true);
    expect(fs.existsSync(imagePath(newPicture))).toBe(true);
  });
});
