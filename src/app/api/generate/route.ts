import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { ok, fail, noSourcesSelected } from "@/lib/http";
import { keepAliveJSON } from "@/lib/keepalive";
import { chatJSON, generateImage, type ChatMsg } from "@/lib/ai";
import { imageDir } from "@/lib/paths";
import { buildContext, citationList, retrieve, sampleCorpus, type Passage } from "@/lib/retrieve";
import { GROUNDING_RULES, STUDIO } from "@/lib/studio";
import {
  DEFAULT_STYLE,
  MAX_INFOGRAPHIC_INSTRUCTIONS,
  buildImagePrompt,
  imageSizeFor,
  isImageStyle,
  knownDetail,
  knownOrientation,
  knownStyle,
  optionsHint,
  styleDef,
  type InfographicStyle,
} from "@/lib/infographic";
import { infographicIsEmpty, normalizeInfographic } from "@/lib/infographicNormalize";
import { normalizeSlides } from "@/lib/slides";
import type {
  ArtifactType,
  InfographicContent,
  StudyDifficulty,
  StudyLength,
  StudyOptions,
} from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Characters of source material sent to the model. Roughly 4 chars per token,
 * so the default lands near 7.5K prompt tokens — comfortably inside a modest
 * per-minute deployment quota while still spanning the whole corpus.
 */
const MAX_CONTEXT_CHARS = Number(process.env.STUDIO_CONTEXT_CHARS || 30000);
const MIN_CONTEXT_CHARS = 6000;

type Loose = Record<string, unknown>;
const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function normalize(type: ArtifactType, raw: Loose): Loose {
  switch (type) {
    case "quiz": {
      const questions = arr(raw.questions)
        .map((q) => {
          const o = q as Loose;
          const choices = arr(o.choices).map((c) => str(c)).filter(Boolean);
          if (!str(o.question) || choices.length < 2) return null;
          const idx = Number(o.answerIndex);
          // Guessing the first choice would mark an arbitrary answer correct.
          if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) return null;

          // Models cluster the correct answer in the first position however
          // firmly the prompt asks otherwise — a generated six-question quiz
          // had the answer at A every time, which is scorable without reading
          // it. Shuffling here is deterministic where the instruction is not.
          // Positions are shuffled rather than values so duplicate choices
          // cannot mislocate the answer.
          const order = choices.map((_, i) => i);
          for (let i = order.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
          }

          return {
            question: str(o.question),
            choices: order.map((i) => choices[i]),
            answerIndex: order.indexOf(idx),
            explanation: str(o.explanation),
          };
        })
        .filter(Boolean);
      return { title: str(raw.title, "Quiz"), questions };
    }
    case "flashcards": {
      const seen = new Set<string>();
      const cards = arr(raw.cards)
        .map((c) => {
          const o = c as Loose;
          const front = str(o.front).trim();
          const back = str(o.back).trim();
          if (!front || !back) return null;
          // Models drift into near-duplicates on long decks; one cue should
          // appear once or the deck quietly wastes the learner's time.
          const key = front.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          if (seen.has(key)) return null;
          seen.add(key);
          return { front, back, hint: str(o.hint).trim() || undefined };
        })
        .filter(Boolean);
      return {
        title: str(raw.title, "Flashcards"),
        subtitle: str(raw.subtitle) || undefined,
        cards,
      };
    }
    case "mindmap": {
      const walk = (n: unknown, depth: number): Loose | null => {
        const o = (n ?? {}) as Loose;
        const label = str(o.label).trim();
        if (!label) return null;
        const children =
          depth >= 3
            ? []
            : arr(o.children)
                .map((c) => walk(c, depth + 1))
                .filter(Boolean);
        return { label, note: str(o.note) || undefined, children };
      };
      const root = walk(raw.root, 0) ?? { label: str(raw.title, "Overview"), children: [] };
      return { title: str(raw.title, "Mind map"), root };
    }
    case "faq": {
      const items = arr(raw.items)
        .map((i) => {
          const o = i as Loose;
          return str(o.q) && str(o.a) ? { q: str(o.q), a: str(o.a) } : null;
        })
        .filter(Boolean);
      return { title: str(raw.title, "FAQ"), items };
    }
    case "timeline": {
      const items = arr(raw.items)
        .map((i) => {
          const o = i as Loose;
          return str(o.title)
            ? { date: str(o.date, "—"), title: str(o.title), text: str(o.text) }
            : null;
        })
        .filter(Boolean);
      return { title: str(raw.title, "Timeline"), items };
    }
    case "infographic":
      return normalizeInfographic(raw) as unknown as Loose;
    default: {
      return {
        title: str(raw.title, STUDIO[type].label),
        subtitle: str(raw.subtitle),
        markdown: str(raw.markdown) || str(raw.content),
      };
    }
  }
}

function isEmpty(type: ArtifactType, c: Loose): boolean {
  if (type === "quiz") return (c.questions as unknown[]).length === 0;
  if (type === "flashcards") return (c.cards as unknown[]).length === 0;
  if (type === "faq") return (c.items as unknown[]).length === 0;
  if (type === "timeline") return (c.items as unknown[]).length === 0;
  if (type === "slides") return (c.slides as unknown[]).length < 3;
  if (type === "infographic") return infographicIsEmpty(c as unknown as InfographicContent);
  if (type === "mindmap") return ((c.root as Loose).children as unknown[]).length === 0;
  return !str(c.markdown).trim();
}

/** Longest focus topic accepted; it is retrieval input and part of the prompt. */
const MAX_TOPIC_CHARS = 2000;

/** Formats built by their own routes; their studio entries carry no prompt. */
const OWN_ROUTE = new Set<string>(["podcast", "video", "motion", "training"]);

const bad = (error: string) => NextResponse.json({ error, code: "invalid" }, { status: 400 });

export function POST(req: Request) {
  return keepAliveJSON(() => generateArtifact(req));
}

async function generateArtifact(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Loose | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return bad("Send a JSON object.");
    }
    const { notebookId, type, topic, sourceIds, style, theme, difficulty, length } =
      body as {
        notebookId: string;
        type: ArtifactType;
        topic?: string;
        sourceIds?: string[];
        style?: string;
        theme?: string;
        difficulty?: StudyDifficulty;
        length?: StudyLength;
      };

    // Own keys only: "constructor" or "__proto__" would otherwise resolve to
    // something that is not a spec and fail later with a confusing error.
    const spec =
      typeof type === "string" && Object.prototype.hasOwnProperty.call(STUDIO, type)
        ? STUDIO[type]
        : undefined;
    if (!spec || OWN_ROUTE.has(type)) {
      return NextResponse.json({ error: "Unknown artifact type" }, { status: 400 });
    }
    if (typeof notebookId !== "string" || !notebookId) return bad("notebookId is required.");
    if (topic !== undefined && topic !== null && typeof topic !== "string") {
      return bad("topic must be a string.");
    }
    if (typeof topic === "string" && topic.length > MAX_TOPIC_CHARS) {
      return bad(`Keep the focus under ${MAX_TOPIC_CHARS} characters.`);
    }
    if (
      sourceIds !== undefined &&
      sourceIds !== null &&
      (!Array.isArray(sourceIds) || sourceIds.some((s) => typeof s !== "string"))
    ) {
      return bad("sourceIds must be a list of source ids.");
    }
    const none = noSourcesSelected(sourceIds);
    if (none) return none;

    // Reject unknown values rather than passing them into the prompt, where
    // they would silently become instructions.
    const safeLength = (["short", "standard", "long"] as const).includes(
      length as StudyLength
    )
      ? length
      : "standard";
    const safeDifficulty = (["easy", "medium", "hard"] as const).includes(
      difficulty as StudyDifficulty
    )
      ? difficulty
      : "medium";

    const studyOpts: StudyOptions | undefined = spec.study
      ? {
          difficulty: safeDifficulty,
          length: safeLength,
        }
      : undefined;
    const instructionOpts: StudyOptions | undefined =
      type === "slides" || spec.sized ? { length: safeLength } : studyOpts;

    // Infographic styles change the content shape, not just the palette.
    // Resolve once: the same key must drive both the prompt and what is
    // stored, or the artifact renders in a style it was not written for.
    // An unknown key is refused rather than stored as-is.
    let activeStyle: InfographicStyle | undefined;
    if (type === "infographic") {
      const known = knownStyle(style || DEFAULT_STYLE);
      if (!known) return bad(`Unknown infographic style "${String(style).slice(0, 40)}".`);
      activeStyle = known;
    }
    const { orientation, detail, instructions } = body as {
      orientation?: unknown;
      detail?: unknown;
      instructions?: unknown;
    };
    if (instructions !== undefined && instructions !== null && typeof instructions !== "string") {
      return bad("instructions must be a string.");
    }
    if (typeof instructions === "string" && instructions.length > MAX_INFOGRAPHIC_INSTRUCTIONS) {
      return bad(`Keep the description under ${MAX_INFOGRAPHIC_INSTRUCTIONS} characters.`);
    }
    const infographicOpts = activeStyle
      ? {
          orientation: knownOrientation(orientation),
          detail: knownDetail(detail),
          instructions: typeof instructions === "string" ? instructions.trim() : "",
        }
      : undefined;
    const styleHint = activeStyle
      ? `\n\nSTYLE: ${styleDef(activeStyle).label}\n${styleDef(activeStyle).hint}`.trimEnd() +
        optionsHint(infographicOpts ?? {})
      : "";

    const collect = (budget: number): Passage[] => {
      if (topic?.trim()) {
        const broad = sampleCorpus(notebookId, sourceIds, Math.round(budget * 0.4));
        const seen = new Set(focusedPassages.map((p) => p.id));
        return [...focusedPassages, ...broad.filter((p) => !seen.has(p.id))].slice(0, 45);
      }
      return sampleCorpus(notebookId, sourceIds, budget);
    };

    const focusedPassages = topic?.trim()
      ? await retrieve(notebookId, topic, sourceIds, 24)
      : [];

    let budget = MAX_CONTEXT_CHARS;
    let passages = collect(budget);

    if (!passages.length) {
      return NextResponse.json(
        { error: "Add at least one source before generating." },
        { status: 400 }
      );
    }

    // A deployment's tokens-per-minute quota caps how much context a single
    // request may carry. Rather than fail, shrink the excerpt budget and retry
    // so generation still succeeds on small deployments.
    let raw: Loose | null = null;
    let lastError: unknown;

    for (let attempt = 0; attempt < 4; attempt++) {
      const messages: ChatMsg[] = [
        {
          role: "system",
          content: `${GROUNDING_RULES}\n\n${spec.instruction(topic?.trim() ?? "", instructionOpts)}${styleHint}`,
        },
        {
          role: "user",
          content: `SOURCE EXCERPTS\n===============\n${buildContext(passages)}`,
        },
      ];
      try {
        raw = await chatJSON<Loose>(messages, 0.5);
        break;
      } catch (e) {
        lastError = e;
        const status = (e as { status?: number })?.status;
        if (status !== 429 || budget <= MIN_CONTEXT_CHARS) throw e;
        budget = Math.max(MIN_CONTEXT_CHARS, Math.floor(budget / 2));
        const next = collect(budget);
        if (!next.length) throw e;
        passages = next;
        console.warn(
          `[generate] rate limited, retrying ${type} with ${budget} chars of context`
        );
      }
    }

    if (!raw) throw lastError;

    const citations = citationList(passages);
    const content =
      type === "slides" ? normalizeSlides(raw, theme, citations) : normalize(type, raw);
    if (!content) {
      return NextResponse.json(
        { error: "The model did not return a usable slide deck. Try again." },
        { status: 502 }
      );
    }
    if (isEmpty(type, content)) {
      return NextResponse.json(
        { error: "The model returned an empty result. Try again or narrow the focus." },
        { status: 502 }
      );
    }

    const id = nanoid(12);
    const title = str(content.title, spec.label);

    // Image styles render the brief as a PNG. The brief itself is still
    // stored, so the artifact keeps its citations — an image alone cannot
    // carry them, and the text in it is not selectable.
    let image: { imageUrl: string; imageModel: string; imageSize: string } | null = null;
    let storedStyle: string | undefined = activeStyle;
    let imageFallback: { from: string; reason: string } | undefined;
    if (activeStyle && isImageStyle(activeStyle)) {
      try {
        const { png, model, size } = await generateImage(
          buildImagePrompt(
            content as Parameters<typeof buildImagePrompt>[0],
            activeStyle,
            infographicOpts?.orientation
          ),
          { size: imageSizeFor(infographicOpts?.orientation) }
        );
        fs.mkdirSync(imageDir(), { recursive: true });
        fs.writeFileSync(path.join(imageDir(), `${id}.png`), png);
        image = { imageUrl: `/api/image/${id}`, imageModel: model, imageSize: size };
      } catch (e) {
        // The grounded brief took a full generation to write and already
        // carries regions, so keep it in the HTML illustrated layout rather
        // than throwing it away with the failed picture.
        const why = (e instanceof Error ? e.message : "The image model failed.")
          // Provider error bodies are JSON noise in a reader-facing note.
          .replace(/\s*\{[\s\S]*\}\s*$/, "")
          .trim();
        console.warn(`[generate] image render failed, keeping the brief as illustrated: ${why}`);
        storedStyle = "illustrated";
        imageFallback = { from: activeStyle, reason: why.slice(0, 300) };
      }
    }

    const stored = {
      ...content,
      ...(storedStyle ? { style: storedStyle } : {}),
      ...(infographicOpts
        ? { orientation: infographicOpts.orientation, detail: infographicOpts.detail }
        : {}),
      ...(imageFallback ? { imageFallback } : {}),
      ...(studyOpts ? { difficulty: studyOpts.difficulty } : {}),
      ...(image ?? {}),
      citations,
    };
    db.prepare(
      "INSERT INTO artifacts (id, notebook_id, type, title, content, created_at) VALUES (?,?,?,?,?,?)"
    ).run(id, notebookId, type, title, JSON.stringify(stored), Date.now());

    return ok({ id, type, title, content: stored, createdAt: Date.now() });
  } catch (e) {
    return fail(e);
  }
}
