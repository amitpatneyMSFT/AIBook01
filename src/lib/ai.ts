import OpenAI, { AzureOpenAI, toFile } from "openai";
import {
  DefaultAzureCredential,
  ClientSecretCredential,
  getBearerTokenProvider,
  type TokenCredential,
} from "@azure/identity";
import { reserve } from "./budget";
import { getSetting, SETTING_CHAT_MODEL, SETTING_EMBED_MODEL, SETTING_IMAGE_MODEL, SETTING_VISION_MODEL } from "./settings";
import { resolveEndpoint, type ResolvedEndpoint } from "./providers";

/**
 * Two client families are supported.
 *
 * "openai"  — any OpenAI-compatible endpoint: a named preset (AI_PROVIDER=
 *             openai, anthropic, gemini, groq, mistral, deepseek, openrouter,
 *             xai, perplexity, together, ollama, lmstudio, llamacpp) or a bare
 *             AI_BASE_URL for llama.cpp, vLLM and anything else that speaks the
 *             protocol. Most local runtimes ignore the API key but the SDK
 *             requires one.
 * "azure"   — Azure OpenAI, with Entra ID or a key.
 *
 * An OpenAI-compatible provider wins when both are configured, so pointing at
 * a local runtime is a one-line change that needs no Azure settings removed.
 * AI_PROVIDER=azure forces Azure even if a base URL is also set.
 */
const forceAzure = process.env.AI_PROVIDER?.trim().toLowerCase() === "azure";
const main: ResolvedEndpoint = forceAzure
  ? { name: "azure", label: "Azure OpenAI", baseURL: null, apiKey: undefined, preset: null }
  : resolveEndpoint("AI");
const baseURL = main.baseURL ?? undefined;
const endpoint = process.env.AZURE_OPENAI_ENDPOINT;

export type Provider = "openai" | "azure";
export const PROVIDER: Provider = baseURL ? "openai" : "azure";
/** Human-readable provider name, for the UI and diagnostics. */
export const PROVIDER_LABEL = PROVIDER === "azure" ? "Azure OpenAI" : main.label;

/** Separate endpoints for embeddings and transcription, when configured. */
const embedEndpoint = resolveEndpoint("AI_EMBEDDING");
const transcribeEndpoint = resolveEndpoint("AI_TRANSCRIPTION");

const apiKey = process.env.AZURE_OPENAI_API_KEY;
const DEFAULT_API_VERSION = "2024-10-21";
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;
const SCOPE = "https://cognitiveservices.azure.com/.default";

/**
 * Azure data-plane API versions are dated releases, not model versions. Picking
 * a model version (e.g. gpt-5's "2025-08-07") yields a confusing 404 on every
 * call, so flag anything that isn't a published release.
 */
const KNOWN_API_VERSIONS = new Set([
  "2023-05-15",
  "2024-02-01",
  "2024-06-01",
  "2024-08-01-preview",
  "2024-10-21",
  "2024-12-01-preview",
  "2025-01-01-preview",
  "2025-03-01-preview",
  "2025-04-01-preview",
]);

const apiVersionLooksWrong =
  !KNOWN_API_VERSIONS.has(apiVersion) && !/-preview$/.test(apiVersion);

/**
 * Model names. For Azure these are *deployment* names; for an OpenAI-compatible
 * endpoint they are model ids.
 *
 * Resolved per call rather than captured at import, so a choice saved from the
 * UI applies immediately. Order: saved setting, then environment, then a
 * default. AI_MODEL / AI_EMBEDDING_MODEL are kept separate from the Azure
 * deployment names so neither provider's config leaks into the other.
 */
/** Defaults a named provider preset supplies, used only for that provider. */
const presetChat = () => (PROVIDER === "openai" ? main.preset?.chatModel : undefined);
const presetEmbed = () =>
  embedEndpoint.baseURL
    ? embedEndpoint.preset?.embedModel
    : PROVIDER === "openai"
      ? main.preset?.embedModel
      : undefined;

export function chatModel(): string {
  return (
    getSetting(SETTING_CHAT_MODEL) ||
    process.env.AI_MODEL?.trim() ||
    presetChat() ||
    process.env.AZURE_OPENAI_DEPLOYMENT ||
    "gpt-4o"
  );
}

export function embedModel(): string {
  return (
    getSetting(SETTING_EMBED_MODEL) ||
    process.env.AI_EMBEDDING_MODEL?.trim() ||
    presetEmbed() ||
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
    "text-embedding-3-small"
  );
}

/** The value configured in the environment, ignoring any saved override. */
export function envChatModel(): string {
  return (
    process.env.AI_MODEL?.trim() ||
    presetChat() ||
    process.env.AZURE_OPENAI_DEPLOYMENT ||
    "gpt-4o"
  );
}

export function envEmbedModel(): string {
  return (
    process.env.AI_EMBEDDING_MODEL?.trim() ||
    presetEmbed() ||
    process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
    "text-embedding-3-small"
  );
}

/**
 * Chat-only providers (Anthropic, Groq, DeepSeek, xAI, Perplexity...) have no
 * embeddings endpoint. Calling one anyway fails with an opaque 404, so say
 * what to configure instead. Retrieval still works by keyword meanwhile.
 */
function embeddingUnavailableReason(): string | null {
  if (PROVIDER !== "openai" || embedEndpoint.baseURL) return null;
  if (!main.preset || main.preset.local || main.preset.embedModel) return null;
  if (process.env.AI_EMBEDDING_MODEL?.trim() || getSetting(SETTING_EMBED_MODEL)) return null;
  return `${main.label} does not offer embeddings. Set AI_EMBEDDING_PROVIDER (e.g. openai, gemini, mistral or ollama) with its key, or AI_EMBEDDING_BASE_URL, to enable semantic search.`;
}

/**
 * Speech-to-text model for audio and video sources. For Azure this is a
 * deployment name (e.g. a whisper or gpt-4o-transcribe deployment).
 */
export function transcriptionModel(): string | null {
  return (
    process.env.AI_TRANSCRIPTION_MODEL?.trim() ||
    (transcribeEndpoint.baseURL ? transcribeEndpoint.preset?.transcriptionModel : undefined) ||
    (PROVIDER === "azure"
      ? process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT?.trim()
      : main.preset?.transcriptionModel) ||
    null
  );
}

export function imageModel(): string {
  return (
    getSetting(SETTING_IMAGE_MODEL) ||
    process.env.AI_IMAGE_MODEL?.trim() ||
    process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT ||
    "gpt-image-2.5-sunburst"
  );
}

/** Reading images is a chat-model capability, so it falls back to that one. */
export function visionModel(): string {
  return (
    getSetting(SETTING_VISION_MODEL) ||
    process.env.AI_VISION_MODEL?.trim() ||
    process.env.AZURE_OPENAI_VISION_DEPLOYMENT ||
    chatModel()
  );
}

export function envVisionModel(): string {
  return (
    process.env.AI_VISION_MODEL?.trim() ||
    process.env.AZURE_OPENAI_VISION_DEPLOYMENT ||
    envChatModel()
  );
}

export function envImageModel(): string {
  return (
    process.env.AI_IMAGE_MODEL?.trim() ||
    process.env.AZURE_OPENAI_IMAGE_DEPLOYMENT ||
    "gpt-image-2.5-sunburst"
  );
}

/**
 * Image generation sits on a different Azure api-version than inference — the
 * dated inference release (2024-10-21) predates the image endpoint and 404s.
 */
const IMAGE_API_VERSION =
  process.env.AZURE_OPENAI_IMAGE_API_VERSION || "2025-04-01-preview";

export type GeneratedImage = { png: Buffer; model: string; size: string };

export type ImageOptions = {
  size?: string;
  quality?: string;
  /**
   * Ask for a transparent background (gpt-image models). Best effort: a model
   * or endpoint that rejects the parameter is retried without it, so callers
   * must cope with an opaque result.
   */
  background?: "transparent" | "opaque";
};

/**
 * Renders a prompt to a PNG. Returns raw bytes rather than a URL because the
 * gpt-image family replies with base64 and no hosted URL to fetch.
 */
export async function generateImage(
  prompt: string,
  opts: ImageOptions = {}
): Promise<GeneratedImage> {
  if (!opts.background) return requestImage(prompt, opts);
  try {
    return await requestImage(prompt, opts);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const message = e instanceof Error ? e.message : "";
    if (status === 400 && /background|output_format/i.test(message)) {
      return requestImage(prompt, { ...opts, background: undefined });
    }
    throw e;
  }
}

async function requestImage(prompt: string, opts: ImageOptions): Promise<GeneratedImage> {
  reserve("image", 12);
  const model = imageModel();
  const size = opts.size || "1536x1024";
  const quality = opts.quality || "high";
  const extra = opts.background
    ? { background: opts.background, output_format: "png" }
    : {};

  const url =
    PROVIDER === "azure"
      ? `${endpoint?.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(
          model
        )}/images/generations?api-version=${IMAGE_API_VERSION}`
      : `${baseURL?.replace(/\/$/, "")}/images/generations`;

  return withRetry(async () => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(
        PROVIDER === "azure"
          ? { prompt, n: 1, size, quality, ...extra }
          : { model, prompt, n: 1, size, response_format: "b64_json", ...extra }
      ),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = Object.assign(
        new Error(
          `Image generation failed (${res.status}). ${body.slice(0, 400)}`
        ),
        {
          status: res.status,
          // withRetry honors Retry-After when it is present. Without this the
          // backoff guesses, and on a small image deployment it guesses short.
          headers: Object.fromEntries(res.headers.entries()),
        }
      );
      throw err;
    }

    const json = (await res.json()) as {
      data?: { b64_json?: string; url?: string }[];
    };
    const first = json.data?.[0];

    // Some OpenAI-compatible servers ignore response_format and hand back a URL.
    if (!first?.b64_json && first?.url) {
      const img = await fetch(first.url);
      if (!img.ok) throw new Error(`Could not download generated image (${img.status}).`);
      return { png: Buffer.from(await img.arrayBuffer()), model, size };
    }

    if (!first?.b64_json) {
      throw new Error("The image model returned no image data.");
    }
    return { png: Buffer.from(first.b64_json, "base64"), model, size };
  }, "image");
}

export class MissingConfigError extends Error {}

function buildCredential(): TokenCredential {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  // Explicit service principal, when one is supplied (CI, containers).
  if (tenantId && clientId && clientSecret) {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
  }

  // Otherwise walk the standard chain: env vars, workload identity, managed
  // identity, then the developer's `az login` / VS Code / Azure PowerShell session.
  return new DefaultAzureCredential(
    clientId ? { managedIdentityClientId: clientId } : undefined
  );
}

let client: OpenAI | AzureOpenAI | null = null;
let tokenProvider: (() => Promise<string>) | null = null;

/**
 * Auth headers for calling the provider directly, for the few endpoints the
 * SDK does not wrap — notably Azure's deployment listing, which lives on an
 * older api-version than inference.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  if (PROVIDER === "openai") {
    const key = main.apiKey;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }
  if (apiKey) return { "api-key": apiKey };
  if (!tokenProvider) tokenProvider = getBearerTokenProvider(buildCredential(), SCOPE);
  return { Authorization: `Bearer ${await tokenProvider()}` };
}

export function getClient(): OpenAI | AzureOpenAI {
  if (client) return client;

  if (PROVIDER === "openai") {
    client = new OpenAI({
      baseURL,
      // Local runtimes ignore this, but the SDK refuses to construct without it.
      apiKey: main.apiKey || "not-needed",
    });
    return client;
  }

  if (!endpoint) {
    throw new MissingConfigError(
      "No model provider is configured. Set AI_PROVIDER (openai, anthropic, gemini, groq, " +
        "mistral, ollama, …) with its API key, AI_BASE_URL for any OpenAI-compatible endpoint, " +
        "or AZURE_OPENAI_ENDPOINT for Azure. See .env.example."
    );
  }

  if (apiKey) {
    client = new AzureOpenAI({ endpoint, apiKey, apiVersion });
  } else {
    // Entra ID. The provider is called per request and handles token caching
    // and refresh, so long-running processes never serve an expired token.
    const azureADTokenProvider = getBearerTokenProvider(buildCredential(), SCOPE);
    client = new AzureOpenAI({ endpoint, azureADTokenProvider, apiVersion });
  }
  return client;
}

/** Turn provider failures into actionable setup guidance rather than a raw code. */
export function describeAuthError(e: unknown): string | null {
  if (e instanceof StudioModelError) {
    return [401, 403, 404, 429].includes(e.status) ? e.message : null;
  }
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as { status?: number })?.status;
  const code = (e as { code?: string })?.code;

  if (PROVIDER === "openai") {
    // Nothing listening is by far the most common failure with a local runtime,
    // and the SDK surfaces it as a bare connection error.
    if (
      code === "ECONNREFUSED" ||
      code === "ENOTFOUND" ||
      /connection error|fetch failed|ECONNREFUSED/i.test(msg)
    ) {
      return `Could not reach the model server at ${baseURL}. Check it is running — for llama.cpp that is 'llama-server --port 8080 -m <model.gguf>', for Ollama 'ollama serve' — and that AI_BASE_URL points at its OpenAI-compatible path (usually ending in /v1).`;
    }
    if (status === 404) {
      return `The model server at ${baseURL} returned 404. Check that AI_MODEL ("${chatModel()}") and AI_EMBEDDING_MODEL ("${embedModel()}") are loaded — with Ollama, 'ollama list' shows what is available.`;
    }
    if (status === 501) {
      return `The model server does not support this operation. Embeddings in particular need a server started with embedding support (llama.cpp: '--embeddings'; Ollama: pull a dedicated model such as nomic-embed-text and set AI_EMBEDDING_MODEL).`;
    }
    if (status === 401 || status === 403) {
      return `The model server at ${baseURL} rejected the credential. Set ${
        main.preset?.keyEnv ? `${main.preset.keyEnv} (or AI_API_KEY)` : "AI_API_KEY"
      } if it requires one.`;
    }
    return null;
  }

  // A 404 here almost always means a misconfigured api-version or a deployment
  // name that does not exist, not a missing resource.
  if (status === 404) {
    const hint = apiVersionLooksWrong
      ? `AZURE_OPENAI_API_VERSION is set to "${apiVersion}", which is not an Azure API version — model versions like "2025-08-07" are not valid here. Use "${DEFAULT_API_VERSION}".`
      : `Check that the deployment names AZURE_OPENAI_DEPLOYMENT ("${chatModel()}") and AZURE_OPENAI_EMBEDDING_DEPLOYMENT ("${embedModel()}") exist on ${endpoint}.`;
    return `Azure OpenAI returned 404. ${hint}`;
  }

  // Retries are already exhausted by the time this is reached.
  if (status === 429) {
    return `Azure OpenAI rate limit exceeded for deployment "${chatModel()}" and automatic retries did not clear it. The deployment's tokens-per-minute quota is likely too small for this much source material — raise its capacity in Azure AI Foundry, select fewer sources, or use a larger deployment.`;
  }

  if (apiKey) return null;

  const isAuth =
    /CredentialUnavailable|AuthenticationRequired|DefaultAzureCredential|AADSTS|managed identity/i.test(
      msg
    );
  const isDenied = /\b401\b|\b403\b|PermissionDenied|Unauthorized|Forbidden/i.test(msg);

  if (isAuth) {
    return `No Microsoft Entra credential was available. Run 'az login' (or set AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET) and restart the server. Details: ${msg}`;
  }
  if (isDenied) {
    return `Entra sign-in succeeded but the identity was denied. Assign it the 'Cognitive Services OpenAI User' role on the Azure OpenAI resource. Details: ${msg}`;
  }
  return null;
}

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type ChatParams = Parameters<AzureOpenAI["chat"]["completions"]["create"]>[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Small deployments (e.g. a 10K-TPM gpt-5-mini) routinely 429 on the large
 * contexts studio generation sends. Azure returns a Retry-After telling us
 * exactly how long to wait, so honor it instead of failing the request.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const MAX_ATTEMPTS = 5;
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number })?.status;
      const retryable = status === 429 || (status !== undefined && status >= 500);
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw e;

      const headers = (e as { headers?: Record<string, string> })?.headers;
      const after = Number(headers?.["retry-after"]);
      const waitMs = Number.isFinite(after) && after > 0
        ? after * 1000
        : Math.min(30_000, 2 ** attempt * 1000) + Math.random() * 500;

      console.warn(
        `[ai] ${label} got ${status}, retrying in ${Math.round(waitMs / 1000)}s ` +
          `(attempt ${attempt + 1}/${MAX_ATTEMPTS})`
      );
      await sleep(waitMs);
    }
  }
  throw lastError;
}

/**
 * Reasoning deployments (gpt-5, o-series) reject a custom `temperature` and
 * accept only the default. We can't infer that from the deployment name, which
 * is user-chosen, so probe once and remember the answer for the process.
 */
const supportsTemperature = new Map<string, boolean>();

function isTemperatureRejection(e: unknown): boolean {
  const err = e as { param?: string; code?: string; message?: string };
  const msg = err?.message ?? String(e);
  return (
    err?.param === "temperature" ||
    /'temperature' does not support|temperature.*not supported/i.test(msg)
  );
}

/** Run a chat call, retrying without `temperature` if the model refuses it. */
async function createChat(
  params: ChatParams & { temperature?: number },
  options: { signal?: AbortSignal } = {},
  client: OpenAI | AzureOpenAI = getClient()
) {
  // Priced by prompt size: studio calls send tens of thousands of characters.
  reserve("chat", Math.max(4, Math.ceil(JSON.stringify(params.messages ?? "").length / 8000)));
  const model = params.model;
  const withoutTemp = () => {
    const { temperature: _omit, ...rest } = params;
    return rest as ChatParams;
  };

  return withRetry(async () => {
    if (supportsTemperature.get(model) === false) {
      return client.chat.completions.create(withoutTemp(), options);
    }
    try {
      const res = await client.chat.completions.create(params as ChatParams, options);
      if (!supportsTemperature.has(model)) supportsTemperature.set(model, true);
      return res;
    } catch (e) {
      if (!isTemperatureRejection(e)) throw e;
      supportsTemperature.set(model, false);
      return client.chat.completions.create(withoutTemp(), options);
    }
  }, "chat");
}

export async function chatText(messages: ChatMsg[], temperature = 0.3): Promise<string> {
  const res = await createChat({ model: chatModel(), temperature, messages });
  return (
    (res as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim() ??
    ""
  );
}

/** `signal` aborts the upstream request, so a stopped answer stops costing tokens. */
export async function chatStream(
  messages: ChatMsg[],
  temperature = 0.3,
  options: { signal?: AbortSignal } = {}
) {
  const res = await createChat(
    {
      model: chatModel(),
      temperature,
      stream: true,
      messages,
    },
    options
  );
  return res as AsyncIterable<{
    choices?: { delta?: { content?: string | null } }[];
  }>;
}

/** A chat message whose user content may carry images, for the vision model. */
export type VisionMsg =
  | { role: "system" | "assistant"; content: string }
  | {
      role: "user";
      content:
        | string
        | (
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }
          )[];
    };

/**
 * One call to the vision model. Returns the raw text and the billed prompt
 * tokens, which callers use to tell whether the image was actually read.
 */
export async function visionChat(
  messages: VisionMsg[],
  opts: { temperature?: number; json?: boolean; signal?: AbortSignal } = {}
): Promise<{ text: string; promptTokens: number; model: string }> {
  const model = visionModel();
  const res = await createChat(
    {
      model,
      temperature: opts.temperature ?? 0.2,
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
      messages: messages as ChatParams["messages"],
    },
    { signal: opts.signal }
  );
  const r = res as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number };
  };
  return {
    text: r.choices?.[0]?.message?.content?.trim() ?? "",
    promptTokens: r.usage?.prompt_tokens ?? 0,
    model,
  };
}

/** Ask the model for a JSON object and parse it defensively. */
export async function chatJSON<T>(messages: ChatMsg[], temperature = 0.4): Promise<T> {
  return jsonChat<T>(getClient(), chatModel(), messages, temperature);
}

async function jsonChat<T>(
  client: OpenAI | AzureOpenAI,
  model: string,
  messages: ChatMsg[],
  temperature: number
): Promise<T> {
  const res = await createChat(
    {
      model,
      temperature,
      response_format: { type: "json_object" },
      messages,
    },
    {},
    client
  );
  const raw =
    (res as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content?.trim() ??
    "";
  return parseJSON<T>(raw);
}

/**
 * Scripts and scene plans (audio overviews, whiteboard videos, motion
 * explainers, training videos) can use a stronger model than chat.
 *
 * AI_STUDIO_MODEL names it. By default it is called through the same client as
 * chat, so any deployment on the same resource works; AI_STUDIO_ENDPOINT points
 * at a different Azure resource instead, with Entra ID or AI_STUDIO_API_KEY.
 * AI_STUDIO_API=anthropic sends it through Claude's Messages API, which Claude
 * deployments in Microsoft Foundry require: the endpoint is the Azure endpoint
 * + /anthropic, or api.anthropic.com with ANTHROPIC_API_KEY when no Azure
 * endpoint is set. AI_STUDIO_BASE_URL overrides the Messages API base URL.
 */
export function studioModel(): string {
  return process.env.AI_STUDIO_MODEL?.trim() || chatModel();
}

const studioApi = () => process.env.AI_STUDIO_API?.trim().toLowerCase();
const studioEndpoint = () => process.env.AI_STUDIO_ENDPOINT?.trim().replace(/\/+$/, "") || null;

let studioClientCache: AzureOpenAI | null = null;

/** The chat client, or one for AI_STUDIO_ENDPOINT when the model lives elsewhere. */
function studioClient(): OpenAI | AzureOpenAI {
  const ep = studioEndpoint();
  if (!ep) return getClient();
  if (studioClientCache) return studioClientCache;
  const key = process.env.AI_STUDIO_API_KEY?.trim();
  studioClientCache = key
    ? new AzureOpenAI({ endpoint: ep, apiKey: key, apiVersion })
    : new AzureOpenAI({
        endpoint: ep,
        azureADTokenProvider: getBearerTokenProvider(buildCredential(), SCOPE),
        apiVersion,
      });
  return studioClientCache;
}

/** Structured JSON for studio scripts and scene plans, on the studio model. */
export async function studioJSON<T>(messages: ChatMsg[], temperature = 0.4): Promise<T> {
  const model = process.env.AI_STUDIO_MODEL?.trim();
  if (!model) return chatJSON<T>(messages, temperature);
  if (studioApi() === "anthropic") return anthropicJSON<T>(model, messages, temperature);
  try {
    return await jsonChat<T>(studioClient(), model, messages, temperature);
  } catch (e) {
    const status = (e as { status?: number })?.status;
    if (status !== 401 && status !== 403 && status !== 404) throw e;
    const where = studioEndpoint() ?? endpoint ?? baseURL ?? "the chat provider";
    const hint =
      status === 404
        ? ` Check that AI_STUDIO_MODEL ("${model}") is deployed on ${where}, or set AI_STUDIO_ENDPOINT to the resource that has it.`
        : ` With Entra ID the identity needs the 'Cognitive Services OpenAI User' role on ${where}.`;
    throw new StudioModelError(
      `${model} returned ${status}: ${(e as Error).message.replace(/\.\s*$/, "")}.${hint}`,
      status,
      {}
    );
  }
}

/** A failure from the Messages API, already worded for the user. */
export class StudioModelError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly headers: Record<string, string>
  ) {
    super(message);
  }
}

const ANTHROPIC_SCOPE = "https://ai.azure.com/.default";
let anthropicTokenProvider: (() => Promise<string>) | null = null;

function anthropicBaseURL(): string {
  const explicit = process.env.AI_STUDIO_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const azure = studioEndpoint() ?? endpoint?.replace(/\/+$/, "");
  if (azure) return `${azure}/anthropic`;
  return "https://api.anthropic.com";
}

async function anthropicHeaders(base: string): Promise<Record<string, string>> {
  const key =
    process.env.AI_STUDIO_API_KEY?.trim() ||
    (/api\.anthropic\.com/.test(base)
      ? process.env.ANTHROPIC_API_KEY?.trim()
      : studioEndpoint()
        ? undefined
        : process.env.AZURE_OPENAI_API_KEY?.trim());
  if (key) return { "x-api-key": key };
  if (!anthropicTokenProvider) {
    anthropicTokenProvider = getBearerTokenProvider(buildCredential(), ANTHROPIC_SCOPE);
  }
  return { Authorization: `Bearer ${await anthropicTokenProvider()}` };
}

/** Newer Claude models reject a custom temperature; remember which do. */
const anthropicTemperature = new Map<string, boolean>();

async function anthropicJSON<T>(
  model: string,
  messages: ChatMsg[],
  temperature: number
): Promise<T> {
  reserve("studio", 8);
  const base = anthropicBaseURL();
  const url = `${base}/v1/messages`;
  const maxTokens = Number(process.env.AI_STUDIO_MAX_TOKENS) || 16000;
  const system = [
    ...messages.filter((m) => m.role === "system").map((m) => m.content),
    "Respond with a single JSON object and nothing else.",
  ].join("\n\n");
  const turns = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const send = async (withTemp: boolean) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...(await anthropicHeaders(base)),
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: turns,
        ...(withTemp ? { temperature: Math.min(1, Math.max(0, temperature)) } : {}),
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 500);
      try {
        detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? detail;
      } catch {}
      const hint =
        res.status === 404
          ? ` Check that AI_STUDIO_MODEL ("${model}") is a Claude deployment on ${base}.`
          : res.status === 401 || res.status === 403
            ? " With Entra ID the identity needs the 'Cognitive Services User' role on the Foundry resource."
            : "";
      throw new StudioModelError(
        `${model} returned ${res.status}: ${detail.replace(/\.\s*$/, "")}.${hint}`,
        res.status,
        Object.fromEntries(res.headers.entries())
      );
    }
    return JSON.parse(text) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
  };

  const body = await withRetry(async () => {
    if (anthropicTemperature.get(model) === false) return send(false);
    try {
      const r = await send(true);
      anthropicTemperature.set(model, true);
      return r;
    } catch (e) {
      if (!(e instanceof StudioModelError) || e.status !== 400 || !/temperature/i.test(e.message)) {
        throw e;
      }
      anthropicTemperature.set(model, false);
      return send(false);
    }
  }, "studio");

  if (body.stop_reason === "max_tokens") {
    throw new Error(
      `${model} ran out of output tokens (${maxTokens}). Raise AI_STUDIO_MAX_TOKENS or choose a shorter length.`
    );
  }
  const raw = (body.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  return parseJSON<T>(raw);
}

export function parseJSON<T>(raw: string): T {
  const cleaned = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error("Model did not return valid JSON.");
  }
}

/** Clients for jobs routed to a different provider than chat, built on first use. */
const sideClients = new Map<string, OpenAI>();

function sideClient(ep: ResolvedEndpoint): OpenAI | null {
  if (!ep.baseURL) return null;
  let c = sideClients.get(ep.baseURL);
  if (!c) {
    c = new OpenAI({ baseURL: ep.baseURL, apiKey: ep.apiKey || "not-needed" });
    sideClients.set(ep.baseURL, c);
  }
  return c;
}

export async function embed(texts: string[], model: string = embedModel()): Promise<number[][]> {
  const unavailable = embeddingUnavailableReason();
  if (unavailable) throw new Error(unavailable);
  const c = sideClient(embedEndpoint) ?? getClient();

  const out: number[][] = [];
  const BATCH = 64;
  for (let i = 0; i < texts.length; i += BATCH) {
    reserve("embed", 1);
    const slice = texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000) || " ");
    const res = await withRetry(
      () => c.embeddings.create({ model, input: slice }),
      "embeddings"
    );
    for (const d of res.data) out.push(d.embedding as number[]);
  }
  return out;
}

/** Whisper-family endpoints refuse uploads above this size. */
export const MAX_TRANSCRIPTION_BYTES = 25 * 1024 * 1024;

/**
 * Speech-to-text for audio and video sources, via the OpenAI transcription
 * API — which OpenAI, Azure OpenAI (whisper / gpt-4o-transcribe deployments),
 * Groq and most local whisper servers implement.
 */
export async function transcribe(
  audio: Buffer,
  filename: string,
  mime: string
): Promise<string> {
  const model = transcriptionModel();
  if (!model) {
    throw new MissingConfigError(
      PROVIDER === "azure"
        ? "Audio and video sources need a transcription deployment. Set AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT to a whisper or gpt-4o-transcribe deployment, or AI_TRANSCRIPTION_PROVIDER to another provider (e.g. openai or groq)."
        : "Audio and video sources need a speech-to-text model. Set AI_TRANSCRIPTION_MODEL (e.g. whisper-1), or AI_TRANSCRIPTION_PROVIDER to a provider that offers one (openai, groq)."
    );
  }
  if (audio.length > MAX_TRANSCRIPTION_BYTES) {
    throw new Error(
      `"${filename}" is ${(audio.length / 1024 / 1024).toFixed(1)} MB; transcription accepts up to 25 MB. Compress it (e.g. a mono 64 kbit/s MP3) or split it into parts.`
    );
  }
  reserve("transcribe", 5);
  const c = sideClient(transcribeEndpoint) ?? getClient();
  const file = await toFile(audio, filename, { type: mime });
  const res = await withRetry(
    () => c.audio.transcriptions.create({ file, model }),
    "transcription"
  );
  return (res as { text?: string }).text?.trim() ?? "";
}
