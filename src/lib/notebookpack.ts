import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { nanoid } from "nanoid";
import { db, transaction } from "./db";
import { chunkText } from "./ingest";
import { notebookNarration } from "./narrationstore";
import { listNotes } from "./notes";
import { audioPath, captionsPath, imagePath, videoPath } from "./paths";
import { listSessions, sessionMessages } from "./sessions";
import { MAX_TITLE_CHARS } from "./limits";

export const PACK_FORMAT = "infiniaibook-notebook";
export const PACK_VERSION = 1;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_SOURCE_CHARS = 5_000_000;
const MAX_ITEMS = 2000;
const ID = /^[A-Za-z0-9_-]{1,32}$/;

type PackSource = {
  id: string;
  title: string;
  kind: string;
  url: string | null;
  text: string;
  summary: string | null;
  createdAt: number;
};

type PackNote = {
  id: string;
  title: string;
  content: string;
  kind: string;
  sourceId: string | null;
  citations: unknown;
  createdAt: number;
  updatedAt: number;
};

type PackArtifact = {
  id: string;
  type: string;
  title: string;
  content: string;
  createdAt: number;
};

type PackMessage = {
  role: string;
  content: string;
  citations: unknown;
  createdAt: number;
};

type PackSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PackMessage[];
};

type Pack = {
  format: string;
  version: number;
  exportedAt: string;
  notebook: {
    title: string;
    emoji: string;
    narrationInstructions: string;
    narrationReplacements: string;
  };
  sources: PackSource[];
  notes: PackNote[];
  artifacts: PackArtifact[];
  sessions: PackSession[];
};

function zipName(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${base || "notebook"}.zip`;
}

function mediaFor(type: string, id: string, content?: string): { disk: string; name: string }[] {
  if (!ID.test(id)) return [];
  if (type === "podcast") return [{ disk: audioPath(id), name: `media/audio/${id}.mp3` }];
  if (type === "infographic") return [{ disk: imagePath(id), name: `media/image/${id}.png` }];
  if (type === "video" || type === "motion" || type === "training") {
    const files = [
      { disk: videoPath(id), name: `media/video/${id}.mp4` },
      { disk: captionsPath(id), name: `media/captions/${id}.vtt` },
    ];
    // Pictures a training video shows live in the shared image folder.
    for (const imageId of type === "training" ? trainingImageIds(content) : []) {
      files.push({ disk: imagePath(imageId), name: `media/image/${imageId}.png` });
    }
    return files;
  }
  return [];
}

/** Ids of the pictures and logo a training video's script refers to. */
function trainingImageIds(content: string | undefined): string[] {
  if (!content) return [];
  try {
    const c = JSON.parse(content) as {
      sections?: { cues?: { imageId?: unknown }[] }[];
      composition?: { logoId?: unknown };
    };
    const ids = new Set<string>();
    for (const s of c.sections ?? [])
      for (const q of s.cues ?? []) if (typeof q.imageId === "string") ids.add(q.imageId);
    if (typeof c.composition?.logoId === "string") ids.add(c.composition.logoId);
    return [...ids].filter((id) => ID.test(id));
  } catch {
    return [];
  }
}

/** A portable zip of one notebook: text, chats, artifacts, and finished media. */
export async function exportNotebookZip(
  notebookId: string
): Promise<{ filename: string; buffer: Buffer } | null> {
  const nb = db
    .prepare("SELECT id, title, emoji FROM notebooks WHERE id = ?")
    .get(notebookId) as { id: string; title: string; emoji: string } | undefined;
  if (!nb) return null;

  const sources = db
    .prepare(
      `SELECT id, title, kind, url, text, summary, created_at
       FROM sources WHERE notebook_id = ? ORDER BY created_at`
    )
    .all(notebookId) as unknown as {
    id: string;
    title: string;
    kind: string;
    url: string | null;
    text: string;
    summary: string | null;
    created_at: number;
  }[];

  const artifacts = db
    .prepare(
      `SELECT id, type, title, content, created_at FROM artifacts
       WHERE notebook_id = ? ORDER BY created_at`
    )
    .all(notebookId) as unknown as {
    id: string;
    type: string;
    title: string;
    content: string;
    created_at: number;
  }[];

  const narration = notebookNarration(notebookId);
  const pack: Pack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    exportedAt: new Date().toISOString(),
    notebook: {
      title: nb.title,
      emoji: nb.emoji,
      narrationInstructions: narration.instructions,
      narrationReplacements: JSON.stringify(narration.replacements),
    },
    sources: sources.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      url: s.url,
      text: s.text,
      summary: s.summary,
      createdAt: s.created_at,
    })),
    notes: listNotes(notebookId).map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      kind: n.kind,
      sourceId: n.sourceId ?? null,
      citations: n.citations ?? null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
    artifacts: artifacts.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      content: a.content,
      createdAt: a.created_at,
    })),
    sessions: listSessions(notebookId).map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: sessionMessages(s.id).map((m) => ({
        role: m.role,
        content: m.content,
        citations: m.citations ?? null,
        createdAt: m.createdAt,
      })),
    })),
  };

  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(pack));
  const added = new Set<string>();
  for (const artifact of artifacts) {
    for (const file of mediaFor(artifact.type, artifact.id, artifact.content)) {
      if (added.has(file.name) || !fs.existsSync(file.disk)) continue;
      added.add(file.name);
      zip.file(file.name, fs.readFileSync(file.disk));
    }
  }
  const buffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return { filename: zipName(nb.title), buffer };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

function remapSourceIds(value: unknown, ids: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => remapSourceIds(item, ids));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if ((key === "sourceId" || key === "notebookId") && typeof item === "string" && ids.has(item)) {
        out[key] = ids.get(item);
      } else {
        out[key] = remapSourceIds(item, ids);
      }
    }
    return out;
  }
  return value;
}

const MEDIA = /^(audio|image|video|captions)\/([A-Za-z0-9_-]{1,32})\.(mp3|png|mp4|vtt)$/;

/**
 * Point references to media at the new ids: URLs such as /api/video/<id>, the
 * clip and caption routes, and the picture ids a training script holds.
 * Exported ids are regenerated, so any left alone would name another notebook's
 * file, or nothing.
 */
function remapMediaRefs(value: unknown, ids: Map<string, string>): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\/api\/(audio|image|video)\/([A-Za-z0-9_-]+)/g, (m, kind, id) =>
        ids.has(id) ? `/api/${kind}/${ids.get(id)}` : m
      )
      .replace(/\/api\/training\/([A-Za-z0-9_-]+)\//g, (m, id) =>
        ids.has(id) ? `/api/training/${ids.get(id)}/` : m
      );
  }
  if (Array.isArray(value)) return value.map((item) => remapMediaRefs(item, ids));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] =
        (key === "imageId" || key === "logoId") && typeof item === "string" && ids.has(item)
          ? ids.get(item)
          : remapMediaRefs(item, ids);
    }
    return out;
  }
  return value;
}

function writeMedia(name: string, bytes: Buffer, mediaIds: Map<string, string>) {
  const m = MEDIA.exec(name);
  if (!m) return;
  const next = mediaIds.get(m[2]);
  if (!next) return;
  const disk =
    m[1] === "audio"
      ? audioPath(next)
      : m[1] === "image"
        ? imagePath(next)
        : m[1] === "video"
          ? videoPath(next)
          : captionsPath(next);
  fs.mkdirSync(path.dirname(disk), { recursive: true });
  fs.writeFileSync(disk, bytes);
}

/**
 * Restore an export as a new notebook. Ids are regenerated so an import cannot
 * overwrite an existing notebook or escape the data directory.
 */
export async function importNotebookZip(buffer: Buffer): Promise<{ id: string; title: string }> {
  if (buffer.length > MAX_ZIP_BYTES) {
    throw new Error("That export is larger than 200 MB.");
  }
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  if (names.length > MAX_ITEMS) throw new Error("That export has too many files.");
  if (names.some((n) => n.includes("..") || n.startsWith("/") || n.includes("\\"))) {
    throw new Error("That export has an unsafe file path.");
  }
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("That file is not a notebook export.");
  const manifestBytes = await manifestFile.async("uint8array");
  if (manifestBytes.byteLength > 50_000_000) {
    throw new Error("The export manifest is too large.");
  }
  let pack: Pack;
  try {
    pack = JSON.parse(new TextDecoder().decode(manifestBytes)) as Pack;
  } catch {
    throw new Error("The export manifest is not valid JSON.");
  }
  if (pack?.format !== PACK_FORMAT || pack.version !== PACK_VERSION) {
    throw new Error("That export is from a newer or different app and cannot be imported.");
  }
  const notebook = asRecord(pack.notebook);
  if (!notebook) throw new Error("The export is missing the notebook.");
  const title = str(notebook.title, MAX_TITLE_CHARS) || "Imported notebook";
  const emoji = str(notebook.emoji, 8) || "📓";
  const sources = Array.isArray(pack.sources) ? pack.sources.slice(0, MAX_ITEMS) : [];
  const notes = Array.isArray(pack.notes) ? pack.notes.slice(0, MAX_ITEMS) : [];
  const artifacts = Array.isArray(pack.artifacts) ? pack.artifacts.slice(0, MAX_ITEMS) : [];
  const sessions = Array.isArray(pack.sessions) ? pack.sessions.slice(0, MAX_ITEMS) : [];

  const notebookId = nanoid(12);
  const sourceIds = new Map<string, string>();
  const artifactIds = new Map<string, string>();
  for (const source of sources) {
    const row = asRecord(source);
    if (row && typeof row.id === "string" && ID.test(row.id)) sourceIds.set(row.id, nanoid(12));
  }
  for (const artifact of artifacts) {
    const row = asRecord(artifact);
    if (row && typeof row.id === "string" && ID.test(row.id)) artifactIds.set(row.id, nanoid(12));
  }

  const mediaFiles: { name: string; bytes: Buffer }[] = [];
  let mediaBytes = 0;
  for (const name of names) {
    if (!name.startsWith("media/") || zip.files[name].dir) continue;
    const file = zip.file(name);
    if (!file) continue;
    const bytes = await file.async("nodebuffer");
    mediaBytes += bytes.length;
    if (mediaBytes > MAX_ZIP_BYTES) throw new Error("The exported media is larger than 200 MB.");
    const rel = name.slice("media/".length);
    // Pictures a training video shows are not artifacts; they still need new ids.
    const picture = /^image\/([A-Za-z0-9_-]{1,32})\.png$/.exec(rel);
    if (picture && !artifactIds.has(picture[1])) artifactIds.set(picture[1], nanoid(12));
    mediaFiles.push({ name: rel, bytes });
  }

  transaction(() => {
    db.prepare(
      "INSERT INTO notebooks (id, title, emoji, created_at, narration_instructions, narration_replacements) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      notebookId,
      title,
      emoji,
      Date.now(),
      str(notebook.narrationInstructions, 4000),
      str(notebook.narrationReplacements, 8000) || "[]"
    );

    const insertSource = db.prepare(
      `INSERT INTO sources (id, notebook_id, title, kind, url, text, chars, summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, source_id, notebook_id, idx, text, embedding, embed_model, embed_dims)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`
    );
    for (const source of sources) {
      const row = asRecord(source);
      if (!row || typeof row.id !== "string" || !sourceIds.has(row.id)) continue;
      const text = str(row.text, MAX_SOURCE_CHARS);
      if (!text.trim()) continue;
      const sourceId = sourceIds.get(row.id)!;
      const sourceTitle = str(row.title, MAX_TITLE_CHARS) || "Untitled source";
      insertSource.run(
        sourceId,
        notebookId,
        sourceTitle,
        str(row.kind, 40) || "text",
        str(row.url, 2000) || null,
        text,
        text.length,
        str(row.summary, 1000) || null,
        Number(row.createdAt) || Date.now()
      );
      chunkText(text).forEach((chunk, idx) => {
        insertChunk.run(nanoid(12), sourceId, notebookId, idx, chunk);
      });
    }

    const insertNote = db.prepare(
      `INSERT INTO notes (id, notebook_id, title, content, kind, source_id, citations, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const note of notes) {
      const row = asRecord(note);
      if (!row) continue;
      const content = str(row.content, 200_000);
      const sourceId =
        typeof row.sourceId === "string" ? sourceIds.get(row.sourceId) ?? null : null;
      const noteCites = remapSourceIds(row.citations ?? null, sourceIds);
      insertNote.run(
        nanoid(12),
        notebookId,
        str(row.title, MAX_TITLE_CHARS) || "Note",
        content,
        row.kind === "ai" ? "ai" : "human",
        sourceId,
        noteCites == null ? null : JSON.stringify(noteCites),
        Number(row.createdAt) || Date.now(),
        Number(row.updatedAt) || Date.now()
      );
    }

    const insertArtifact = db.prepare(
      `INSERT INTO artifacts (id, notebook_id, type, title, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const artifact of artifacts) {
      const row = asRecord(artifact);
      if (!row || typeof row.id !== "string") continue;
      // Map.has does not narrow Map.get, and node:sqlite rejects undefined binds.
      const artifactId = artifactIds.get(row.id);
      if (!artifactId) continue;
      let content = str(row.content, 2_000_000);
      try {
        content = JSON.stringify(
          remapMediaRefs(remapSourceIds(JSON.parse(content), sourceIds), artifactIds)
        );
      } catch {
        /* keep the original string if it is not JSON */
      }
      insertArtifact.run(
        artifactId,
        notebookId,
        str(row.type, 40) || "report",
        str(row.title, MAX_TITLE_CHARS) || "Artifact",
        content,
        Number(row.createdAt) || Date.now()
      );
    }

    const insertSession = db.prepare(
      `INSERT INTO chat_sessions (id, notebook_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insertMessage = db.prepare(
      `INSERT INTO messages (id, notebook_id, session_id, role, content, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const session of sessions) {
      const row = asRecord(session);
      if (!row) continue;
      const sessionId = nanoid(12);
      const created = Number(row.createdAt) || Date.now();
      insertSession.run(
        sessionId,
        notebookId,
        str(row.title, 120) || "Imported chat",
        created,
        Number(row.updatedAt) || created
      );
      const messages = Array.isArray(row.messages) ? row.messages : [];
      for (const message of messages) {
        const turn = asRecord(message);
        if (!turn) continue;
        const role = turn.role === "assistant" ? "assistant" : "user";
        const messageCites = remapSourceIds(turn.citations ?? null, sourceIds);
        insertMessage.run(
          nanoid(12),
          notebookId,
          sessionId,
          role,
          str(turn.content, 200_000),
          messageCites == null ? null : JSON.stringify(messageCites),
          Number(turn.createdAt) || created
        );
      }
    }
  });

  try {
    for (const file of mediaFiles) writeMedia(file.name, file.bytes, artifactIds);
  } catch (e) {
    db.prepare("DELETE FROM notebooks WHERE id = ?").run(notebookId);
    throw e;
  }

  return { id: notebookId, title };
}
