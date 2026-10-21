import { reserve } from "./budget";
import { VASA2_REGIONS } from "./avatars";
import {
  avatarConfigured,
  avatarNotConfigured,
  speechBearerToken,
  speechEndpoint,
  speechHeaders,
  speechKeyAuth,
} from "./avatarbatch";

/**
 * Live avatar sessions: the browser streams the avatar over WebRTC with the
 * Speech SDK. The server exchanges its key or Entra credential for a
 * short-lived Speech token and returns only that, so keys and Entra tokens
 * never reach the page.
 */

export type LiveStatus = { ready: boolean; region?: string; problem?: string };

const regionName = () => process.env.AZURE_SPEECH_REGION?.trim().toLowerCase();

/** Whether this deployment can run a VASA-2 live session, and if not, why. */
export function liveStatus(): LiveStatus {
  if (!avatarConfigured()) return { ready: false, problem: avatarNotConfigured().message };
  const region = regionName();
  const where = VASA2_REGIONS.join(", ");
  if (!region) {
    return {
      ready: false,
      problem: `Set AZURE_SPEECH_REGION to your Speech resource's region. VASA-2 runs only in ${where}.`,
    };
  }
  if (!(VASA2_REGIONS as readonly string[]).includes(region)) {
    return {
      ready: false,
      region,
      problem: `VASA-2 is not available in ${region}. It runs only in ${where}; use a Speech resource there.`,
    };
  }
  return { ready: true, region };
}

export type LiveSession = {
  token: string;
  region: string;
  ice: { urls: string[]; username: string; credential: string };
};

export class LiveUnavailableError extends Error {}

async function speechToken(region: string): Promise<string> {
  const key = speechKeyAuth();
  if (key) {
    const res = await fetch(
      `https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      { method: "POST", headers: { "Ocp-Apim-Subscription-Key": key } },
    );
    if (!res.ok) throw new Error(`Azure Speech refused to issue a token (${res.status}).`);
    return (await res.text()).trim();
  }
  const endpoint = speechEndpoint()?.replace(/\/+$/, "");
  if (!endpoint) {
    throw new LiveUnavailableError(
      "Live avatars with Entra sign-in need AZURE_SPEECH_RESOURCE_ID (the full /subscriptions/.../accounts/<name> id) or AZURE_SPEECH_ENDPOINT, or use AZURE_SPEECH_KEY.",
    );
  }
  // Exchange the broad Entra bearer for a short-lived Speech token here, so
  // only the narrow token ever reaches the browser.
  const res = await fetch(`${endpoint}/sts/v1.0/issueToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await speechBearerToken()}` },
  });
  if (!res.ok) throw new Error(`Azure Speech refused to issue a token (${res.status}).`);
  return (await res.text()).trim();
}

function relayUrl(region: string): string {
  const endpoint = speechEndpoint() ?? "";
  return /\.cognitiveservices\.azure\.com$/i.test(endpoint)
    ? `${endpoint}/tts/cognitiveservices/avatar/relay/token/v1`
    : `https://${region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`;
}

async function iceServer(region: string): Promise<LiveSession["ice"]> {
  const res = await fetch(relayUrl(region), { headers: await speechHeaders() });
  if (!res.ok) throw new Error(`Azure Speech could not provide a relay server (${res.status}).`);
  const j = (await res.json()) as Record<string, unknown>;
  const pick = (a: string, b: string) => j[a] ?? j[b];
  const urls = [pick("Urls", "urls")].flat().filter((u): u is string => typeof u === "string");
  const username = pick("Username", "username");
  const credential = pick("Password", "password") ?? j.credential;
  // The SDK needs the turn: entries only.
  const turn = urls.filter((u) => u.startsWith("turn:") || u.startsWith("turns:"));
  if (!turn.length || typeof username !== "string" || typeof credential !== "string") {
    throw new Error("Azure Speech returned an unexpected relay response.");
  }
  return { urls: turn, username, credential };
}

/** Credentials for one live session. Counts a rough estimate against the daily budget. */
export async function startLiveSession(): Promise<LiveSession> {
  const status = liveStatus();
  if (!status.ready || !status.region) throw new LiveUnavailableError(status.problem);
  reserve("avatar-live", 25);
  const [token, ice] = await Promise.all([speechToken(status.region), iceServer(status.region)]);
  return { token, region: status.region, ice };
}
