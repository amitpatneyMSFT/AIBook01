export class JSONReplyError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "JSONReplyError";
  }
}

/**
 * Read a JSON reply defensively. A proxy timeout or crash page is plain text,
 * and `res.json()` would surface it as "Unexpected token…" instead of a
 * message a person can act on.
 */
export async function readJSONReply<T extends { error?: string; status?: number }>(
  res: Response,
  fallback = "The request failed."
): Promise<T> {
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    if (res.status === 408 || res.status === 504 || /time(d)?\s*out/i.test(text)) {
      throw new Error(
        "The server took too long to respond. The work may still finish — check the library in a few minutes before trying again."
      );
    }
    const detail = text.trim().slice(0, 200);
    throw new Error(detail ? `${fallback} (${res.status}: ${detail})` : `${fallback} (${res.status})`);
  }
  if (!res.ok || (json && typeof json.error === "string")) {
    throw new JSONReplyError(
      json?.error || fallback,
      typeof json?.status === "number" && json.status >= 400 && json.status <= 599
        ? json.status
        : res.status,
    );
  }
  return json;
}
