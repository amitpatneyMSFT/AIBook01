import fs from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  DefaultAzureCredential,
  ClientSecretCredential,
  getBearerTokenProvider,
  type TokenCredential,
} from "@azure/identity";
import { BATCH_PHOTO_MODELS, DEFAULT_PHOTO_MODEL } from "./avatars";

/**
 * Azure Speech "Text to Speech Avatar" batch synthesis — the Foundry model
 * behind training videos.
 *
 * Entra ID only works against the resource's custom-domain endpoint
 * (https://<name>.cognitiveservices.azure.com); the regional endpoint accepts
 * keys alone. The identity needs "Cognitive Services Speech User" (or Speech
 * Contributor), which carries the BatchAvatar data actions — Owner and
 * Contributor on the subscription do not.
 */

const API_VERSION = "2024-08-01";
const SCOPE = "https://cognitiveservices.azure.com/.default";

export class AvatarNotConfiguredError extends Error {}

function buildCredential(): TokenCredential {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (tenantId && clientId && clientSecret) {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
  }
  return new DefaultAzureCredential(
    clientId ? { managedIdentityClientId: clientId } : undefined,
  );
}

let tokenProvider: (() => Promise<string>) | null = null;

/** Read per call so a changed .env.local applies after a restart without surprises. */
function config() {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim();
  const resourceId = process.env.AZURE_SPEECH_RESOURCE_ID?.trim();
  const explicit = process.env.AZURE_SPEECH_ENDPOINT?.trim().replace(
    /\/+$/,
    "",
  );

  let endpoint = explicit;
  if (!endpoint && resourceId) {
    // Foundry and AI Services resources get a custom subdomain named after the
    // account, which is the last segment of the resource id.
    const name = resourceId.split("/").filter(Boolean).pop();
    if (name)
      endpoint = `https://${name.toLowerCase()}.cognitiveservices.azure.com`;
  }
  if (!endpoint && key && region) {
    endpoint = `https://${region}.api.cognitive.microsoft.com`;
  }
  return { key, endpoint };
}

export function avatarConfigured(): boolean {
  return Boolean(config().endpoint);
}

export const avatarNotConfigured = () =>
  new AvatarNotConfiguredError(
    "Training videos need an Azure Speech resource. Set AZURE_SPEECH_RESOURCE_ID (Entra) or AZURE_SPEECH_ENDPOINT, or AZURE_SPEECH_KEY with AZURE_SPEECH_REGION. See .env.example.",
  );

async function headers(): Promise<Record<string, string>> {
  const { key } = config();
  const h: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "InfiniAIBook",
  };
  if (key) {
    h["Ocp-Apim-Subscription-Key"] = key;
  } else {
    if (!tokenProvider)
      tokenProvider = getBearerTokenProvider(buildCredential(), SCOPE);
    h.Authorization = `Bearer ${await tokenProvider()}`;
  }
  return h;
}

export const speechHeaders = headers;

/** The resource endpoint avatar calls go to, or undefined when none is configured. */
export const speechEndpoint = (): string | undefined => config().endpoint;

/** Whether the resource is addressed by key rather than Entra ID. */
export const speechKeyAuth = (): string | undefined => config().key;

/** An Entra access token for Azure Speech. */
export async function speechBearerToken(): Promise<string> {
  if (!tokenProvider)
    tokenProvider = getBearerTokenProvider(buildCredential(), SCOPE);
  return tokenProvider();
}

function url(synthesisId: string): string {
  const { endpoint } = config();
  if (!endpoint) throw avatarNotConfigured();
  return `${endpoint}/avatar/batchsyntheses/${encodeURIComponent(
    synthesisId,
  )}?api-version=${API_VERSION}`;
}

/** Turn the service's failures into something a person can act on. */
async function failure(res: Response, action: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  let message = body.slice(0, 400);
  try {
    const j = JSON.parse(body) as {
      error?: { code?: string; message?: string };
    };
    if (j.error?.message) message = j.error.message;
  } catch {
    /* not JSON */
  }
  let error: Error;
  if (res.status === 401 || res.status === 403) {
    error = new Error(
      `Azure Speech refused to ${action} (${res.status}). The signed-in identity needs the "Cognitive Services Speech User" role on the Speech resource — subscription Owner is not enough, because avatar synthesis is a data action. ${message}`,
    );
  } else if (res.status === 404) {
    error = new Error(
      `Azure Speech could not ${action} (404). Check AZURE_SPEECH_ENDPOINT points at the resource's custom domain, and that the resource's region offers text to speech avatar. ${message}`,
    );
  } else {
    error = new Error(
      `Azure Speech could not ${action} (${res.status}). ${message}`,
    );
  }
  return Object.assign(error, { status: res.status });
}

export type AvatarJobStatus = "NotStarted" | "Running" | "Succeeded" | "Failed";

export type AvatarJob = {
  id: string;
  status: AvatarJobStatus;
  outputs?: { result?: string; summary?: string };
  properties?: {
    durationInMilliseconds?: number;
    sizeInBytes?: number;
    billingDetails?: { talkingAvatarDurationSeconds?: number };
    error?: { code?: string; message?: string };
  };
};

export type AvatarJobOptions = {
  character: string;
  /** Omitted for characters Microsoft lists without a style. */
  style?: string;
  /** A head-only photo avatar, driven by a VASA model. */
  photo?: boolean;
  /** The VASA base model for a photo avatar; VASA-1 when omitted. */
  photoModel?: string;
  /** #RRGGBB; ignored when a background image is configured or `transparent` is set. */
  background: string;
  description?: string;
  /**
   * WebM/VP9 with an alpha channel and no subtitles, for laying the presenter
   * over slides. VP9 renders more slowly than H.264.
   */
  transparent?: boolean;
};

/**
 * Submit one SSML script as one video.
 *
 * H.264 rather than the service's default HEVC, which Chrome and Firefox on
 * most machines cannot play. Subtitles are burned in so they survive download
 * and re-upload anywhere. Transparent clips are composited later, which draws
 * its own captions.
 */
export async function submitAvatarJob(
  synthesisId: string,
  ssml: string,
  opts: AvatarJobOptions,
): Promise<AvatarJob> {
  const photoModel = opts.photoModel ?? DEFAULT_PHOTO_MODEL;
  if (opts.photo && !(BATCH_PHOTO_MODELS as readonly string[]).includes(photoModel)) {
    throw new Error(
      `${photoModel} avatars are not supported by batch synthesis yet. Choose another presenter.`,
    );
  }
  const image = process.env.AZURE_AVATAR_BACKGROUND_URL?.trim();
  const body = {
    description: opts.description?.slice(0, 200),
    inputKind: "SSML",
    inputs: [{ content: ssml }],
    avatarConfig: {
      talkingAvatarCharacter: opts.character,
      ...(opts.style ? { talkingAvatarStyle: opts.style } : {}),
      ...(opts.photo
        ? { photoAvatarBaseModel: photoModel }
        : {}),
      ...(opts.transparent
        ? {
            videoFormat: "webm",
            videoCodec: "vp9",
            subtitleType: "none",
            bitrateKbps: 2000,
            backgroundColor: "#00000000",
          }
        : {
            videoFormat: "mp4",
            videoCodec: "h264",
            subtitleType: "hard_embedded",
            bitrateKbps: 2000,
            ...(image && /^https:\/\//i.test(image)
              ? { backgroundImage: image }
              : { backgroundColor: `${opts.background}FF` }),
          }),
    },
  };

  const res = await fetch(url(synthesisId), {
    method: "PUT",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, "start the avatar render");
  return (await res.json()) as AvatarJob;
}

export async function getAvatarJob(synthesisId: string): Promise<AvatarJob> {
  const res = await fetch(url(synthesisId), { headers: await headers() });
  if (!res.ok) throw await failure(res, "report on the avatar render");
  return (await res.json()) as AvatarJob;
}

/** Best effort: the service keeps results for 31 days otherwise. */
export async function deleteAvatarJob(synthesisId: string): Promise<void> {
  try {
    await fetch(url(synthesisId), {
      method: "DELETE",
      headers: await headers(),
    });
  } catch {
    /* already gone, or never existed */
  }
}

/**
 * Stream the finished video to disk. The result link is a pre-signed blob URL,
 * so it takes no credential — and must not be sent one.
 */
export async function downloadAvatarResult(
  resultUrl: string,
  file: string,
): Promise<number> {
  if (!/^https:\/\//i.test(resultUrl)) {
    throw new Error("The avatar service returned an unexpected result link.");
  }
  const res = await fetch(resultUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Could not download the rendered video (${res.status}).`);
  }
  const tmp = `${file}.part`;
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    fs.createWriteStream(tmp),
  );
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows refuses to replace a file another handle has open, such as the
    // previous render still being streamed to a player.
    fs.rmSync(file, { force: true });
    fs.renameSync(tmp, file);
  }
  return fs.statSync(file).size;
}

/** Why a job failed, from wherever the service put it. */
export async function avatarFailureReason(job: AvatarJob): Promise<string> {
  const direct = job.properties?.error?.message;
  if (direct) return direct;
  const summary = job.outputs?.summary;
  if (summary && /^https:\/\//i.test(summary)) {
    try {
      const res = await fetch(summary);
      if (res.ok) {
        const j = (await res.json()) as {
          results?: { status?: string; error?: string }[];
        };
        const err = j.results?.find((r) => r.error)?.error;
        if (err) return err;
      }
    } catch {
      /* fall through */
    }
  }
  return "The avatar render failed without a reason from Azure.";
}
