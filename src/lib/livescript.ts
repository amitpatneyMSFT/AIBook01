/**
 * The live presenter speaks the training transcript, so the transcript is cut
 * into pieces small enough to send to the avatar one after another. A piece
 * never crosses a section, so the page can show which section is being spoken.
 */

export type LiveChunk = { section: number; text: string };

export const MAX_LIVE_CHUNK_CHARS = 600;

function splitLong(paragraph: string, max: number): string[] {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [paragraph];
  const out: string[] = [];
  let cur = "";
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (cur && cur.length + 1 + s.length > max) {
      out.push(cur);
      cur = "";
    }
    if (s.length > max) {
      // A sentence with no stop in range: cut at words.
      for (const w of s.split(/\s+/)) {
        if (cur && cur.length + 1 + w.length > max) {
          out.push(cur);
          cur = w;
        } else {
          cur = cur ? `${cur} ${w}` : w;
        }
      }
    } else {
      cur = cur ? `${cur} ${s}` : s;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Paragraph-sized pieces of the transcript, in order, each tagged with its section. */
export function liveChunks(
  sections: readonly { text: string }[],
  max = MAX_LIVE_CHUNK_CHARS,
): LiveChunk[] {
  const chunks: LiveChunk[] = [];
  sections.forEach((s, section) => {
    for (const p of s.text.split(/\n\s*\n/)) {
      const paragraph = p.replace(/\s+/g, " ").trim();
      if (!paragraph) continue;
      for (const text of splitLong(paragraph, max)) chunks.push({ section, text });
    }
  });
  return chunks;
}
