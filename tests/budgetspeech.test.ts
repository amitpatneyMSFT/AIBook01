import { describe, expect, it } from "vitest";
import { budgetStatus, cloudSpendLikely, dailyBudgetCents } from "@/lib/budget";

const KEYS = [
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_RESOURCE_ID",
  "AZURE_SPEECH_ENDPOINT",
  "AZURE_SPEECH_KEY",
  "OPENAI_API_KEY",
  "AI_PROVIDER",
  "AI_BASE_URL",
  "DAILY_BUDGET_USD",
] as const;

function withEnv(env: Partial<Record<(typeof KEYS)[number], string>>, fn: () => void) {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

describe("budget defaults", () => {
  it("stays off for a fully local setup", () => {
    withEnv({ AI_PROVIDER: "ollama" }, () => expect(dailyBudgetCents()).toBeNull());
  });

  it("applies the default ceiling when paid Azure Speech is configured with a local chat model", () => {
    withEnv({ AI_PROVIDER: "ollama", AZURE_SPEECH_RESOURCE_ID: "/subscriptions/x/accounts/speech" }, () => {
      expect(cloudSpendLikely()).toBe(true);
      expect(dailyBudgetCents()).toBe(2500);
      expect(budgetStatus().enabled).toBe(true);
    });
    withEnv({ AI_PROVIDER: "ollama", AZURE_SPEECH_KEY: "k" }, () => expect(cloudSpendLikely()).toBe(true));
  });

  it("honors an explicit ceiling of zero", () => {
    withEnv({ AZURE_SPEECH_KEY: "k", DAILY_BUDGET_USD: "0" }, () => expect(dailyBudgetCents()).toBeNull());
  });
});
