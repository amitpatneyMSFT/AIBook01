import {
  DefaultAzureCredential,
  ClientSecretCredential,
  getBearerTokenProvider,
  type TokenCredential,
} from "@azure/identity";
import { reserve } from "./budget";
import { addBreaths, turnLeadIn } from "./prosody";
import { VOICE_PRESETS, type SpeakerId, type VoiceSelection } from "./voices";
export type { SpeakerId, VoicePair } from "./voices";

const SCOPE = "https://cognitiveservices.azure.com/.default";

const region = process.env.AZURE_SPEECH_REGION;
const resourceId = process.env.AZURE_SPEECH_RESOURCE_ID;
const speechKey = process.env.AZURE_SPEECH_KEY;

/** 96 kbit/s constant-bitrate mono MP3 — 12000 bytes per second of audio. */
const OUTPUT_FORMAT = "audio-24khz-96kbitrate-mono-mp3";
const BYTES_PER_SECOND = 12000;

export const MULTITALKER_VOICE = "en-Multitalker:DragonHDLatestNeural";

export class SpeechNotConfiguredError extends Error {}

export type Turn = { speaker: SpeakerId; text: string };

function buildCredential(): TokenCredential {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (tenantId && clientId && clientSecret) {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return new DefaultAzureCredential(
    clientId ? { managedIdentityClientId: clientId } : undefined
  );
}

let tokenProvider: (() => Promise<string>) | null = null;

async function authHeader(): Promise<string> {
  if (speechKey) return "";
  if (!tokenProvider) tokenProvider = getBearerTokenProvider(buildCredential(), SCOPE);
  // Speech requires the Entra token to be paired with the resource id.
  return `Bearer aad#${resourceId}#${await tokenProvider()}`;
}

function assertConfigured() {
  if (!region) {
    throw new SpeechNotConfiguredError(
      "Audio overviews need Azure Speech. Set AZURE_SPEECH_REGION (e.g. eastus2) plus AZURE_SPEECH_RESOURCE_ID for Entra auth, or AZURE_SPEECH_KEY. See .env.example."
    );
  }
  if (!speechKey && !resourceId) {
    throw new SpeechNotConfiguredError(
      "Azure Speech with Entra requires AZURE_SPEECH_RESOURCE_ID (the full /subscriptions/.../accounts/<name> id). Alternatively set AZURE_SPEECH_KEY."
    );
  }
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

function buildSsml(
  turns: Turn[],
  voices: VoiceSelection,
  rate = 1,
  breath = 1
): string {
  // The multitalker voice takes a unitless multiplier; classic neural voices
  // take a percentage offset. Omit entirely at normal speed so the default
  // delivery is untouched.
  const wrap = (text: string, isFirst: boolean) => {
    // Escape before inserting breaks: the other order would encode the tags
    // into literal angle brackets and the voice would read them aloud.
    const escaped = addBreaths(escapeXml(text), breath);
    // No lead-in on the opening line — a pause before anything has been said
    // just sounds like a slow start.
    const body = isFirst ? escaped : `${turnLeadIn(text, breath)}${escaped}`;
    if (rate === 1) return body;
    const value = voices.multitalker
      ? rate.toFixed(2)
      : `${rate >= 1 ? "+" : ""}${Math.round((rate - 1) * 100)}%`;
    return `<prosody rate='${value}'>${body}</prosody>`;
  };

  const body = voices.multitalker
    ? `<voice name='${MULTITALKER_VOICE}'><mstts:dialog>${turns
        .map(
          (t, i) =>
            `<mstts:turn speaker='${voices[t.speaker] ?? voices.a}'>${wrap(
              t.text,
              i === 0
            )}</mstts:turn>`
        )
        .join("")}</mstts:dialog></voice>`
    : turns
        .map(
          (t, i) =>
            `<voice name='${voices[t.speaker] ?? voices.a}'>${wrap(
              t.text,
              i === 0
            )}</voice>`
        )
        .join("");

  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>${body}</speak>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function synthesize(ssml: string, format?: string): Promise<Buffer> {
  reserve("speech", Math.max(4, Math.ceil(ssml.length / 1000) * 3));
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const headers: Record<string, string> = {
    "Content-Type": "application/ssml+xml",
    "X-Microsoft-OutputFormat": format || OUTPUT_FORMAT,
    "User-Agent": "InfiniAIBook",
  };
  if (speechKey) headers["Ocp-Apim-Subscription-Key"] = speechKey;
  else headers["Authorization"] = await authHeader();

  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { method: "POST", headers, body: ssml });
      if (res.status === 429 || res.status >= 500) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : 2 ** attempt * 1000);
        lastError = new Error(`Speech returned ${res.status}`);
        continue;
      }
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        if (res.status === 401 || res.status === 403) {
          throw new Error(
            `Azure Speech rejected the credential (${res.status}). The identity needs the 'Cognitive Services Speech User' role on the resource. ${detail}`
          );
        }
        throw new Error(`Azure Speech failed (${res.status}): ${detail}`);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastError = e;
      // A long SSML payload can have its connection dropped mid-stream; the
      // caller keeps chunks small, but retry once more before giving up.
      if (attempt === 3) throw e;
      await sleep(2 ** attempt * 1000);
    }
  }
  throw lastError;
}

export type SynthesisResult = {
  audio: Buffer;
  durationSec: number;
  /** Start offset in seconds for each input turn, for transcript highlighting. */
  offsets: number[];
};

/**
 * Render hand-written SSML. Exposed for probing what the voice actually
 * supports: the service accepts and ignores markup it does not implement
 * rather than refusing it, so the only way to know is to measure.
 *
 * `format` overrides the output codec — uncompressed PCM makes the audio
 * directly analysable without decoding.
 */
export async function synthesizeRawSsml(
  ssml: string,
  format?: string
): Promise<Buffer> {
  assertConfigured();
  return synthesize(ssml, format);
}

export type ServiceVoice = {
  ShortName: string;
  DisplayName?: string;
  Gender?: string;
  Locale: string;
  VoiceType?: string;
  Status?: string;
  StyleList?: string[];
};

/** Every voice the resource's region offers, with the styles each declares. */
export async function listServiceVoices(): Promise<ServiceVoice[]> {
  assertConfigured();
  const headers: Record<string, string> = { "User-Agent": "InfiniAIBook" };
  if (speechKey) headers["Ocp-Apim-Subscription-Key"] = speechKey;
  else headers["Authorization"] = await authHeader();
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
    headers,
  });
  if (!res.ok) throw new Error(`Azure Speech could not list voices (${res.status}).`);
  return (await res.json()) as ServiceVoice[];
}

export function wrapSsml(inner: string, voice = MULTITALKER_VOICE): string {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${voice}'><mstts:dialog><mstts:turn speaker='Ava'>${inner}</mstts:turn></mstts:dialog></voice></speak>`;
}

/**
 * Render a dialogue to a single MP3.
 *
 * Turns are synthesised in small batches: one request per batch keeps the
 * multitalker voice's cross-turn prosody, while staying far below the payload
 * size at which the service drops the connection.
 */
export async function synthesizeDialogue(
  turns: Turn[],
  voices: VoiceSelection = VOICE_PRESETS.conversational,
  rate = 1,
  batchSize = 6,
  breath = 1
): Promise<SynthesisResult> {
  assertConfigured();
  if (!turns.length) throw new Error("Nothing to synthesize.");

  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let elapsed = 0;

  for (let i = 0; i < turns.length; i += batchSize) {
    const batch = turns.slice(i, i + batchSize);
    const audio = await synthesize(buildSsml(batch, voices, rate, breath));
    const batchSeconds = audio.length / BYTES_PER_SECOND;

    // Exact offset for the batch; within it, apportion by text length. Good
    // enough to keep the highlighted line in step with the narration.
    const totalChars = batch.reduce((n, t) => n + t.text.length, 0) || 1;
    let consumed = 0;
    for (const t of batch) {
      offsets.push(elapsed + (consumed / totalChars) * batchSeconds);
      consumed += t.text.length;
    }

    parts.push(audio);
    elapsed += batchSeconds;
  }

  return {
    audio: Buffer.concat(parts),
    durationSec: elapsed,
    offsets,
  };
}

export function describeSpeechError(e: unknown): string | null {
  if (e instanceof SpeechNotConfiguredError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/Cognitive Services Speech User|rejected the credential/i.test(msg)) return msg;
  return null;
}
