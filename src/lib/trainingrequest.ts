import { JSONReplyError, readJSONReply } from "./jsonreply";

export class TrainingRequestError extends Error {
  constructor(message: string, public readonly status: number | undefined, cause: unknown) {
    super(message, { cause });
    this.name = "TrainingRequestError";
  }
}

/** Keep transport failures distinguishable from server replies during render preparation. */
export async function trainingRequest<T extends { error?: string }>(
  url: string,
  step: string,
  init?: RequestInit,
): Promise<T> {
  const method = init?.method ?? "GET";
  let response: Response | undefined;
  try {
    response = await fetch(url, init);
    return await readJSONReply<T>(response, `${step} failed.`);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Unknown error";
    const status = response ? `HTTP ${response.status}` : "no HTTP response";
    console.error("[training] request failed", { step, method, url, status }, cause);
    throw new TrainingRequestError(
      `${step} failed (${method} ${url}; ${status}): ${detail}${
        !response
          ? ". Check your connection and the browser Console. If render submission was interrupted, check the video's progress before trying again."
          : ""
      }`,
      cause instanceof JSONReplyError ? cause.status : response?.status,
      cause,
    );
  }
}
