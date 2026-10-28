import { db, transaction } from "./db";

/**
 * A daily ceiling on estimated model, speech and image spend.
 *
 * Prices are rough on purpose: providers do not share one rate card, and a
 * ceiling that is slightly high still stops a runaway loop. Amounts are US
 * cents. `DAILY_BUDGET_USD=0` turns the ceiling off. When the variable is
 * unset, cloud configurations default to $25 and local endpoints (Ollama,
 * llama.cpp, LM Studio, any http:// or loopback base URL) are unlimited.
 */
export class BudgetExceededError extends Error {
  readonly code = "budget";
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "llamacpp"]);

/** Whether this process is pointed at a service that bills by the call. */
export function cloudSpendLikely(): boolean {
  // Speech and avatar calls are billed however local the chat model is.
  if (
    process.env.AZURE_SPEECH_REGION?.trim() ||
    process.env.AZURE_SPEECH_RESOURCE_ID?.trim() ||
    process.env.AZURE_SPEECH_ENDPOINT?.trim() ||
    process.env.AZURE_SPEECH_KEY?.trim()
  ) {
    return true;
  }
  const provider = process.env.AI_PROVIDER?.trim().toLowerCase() ?? "";
  if (LOCAL_PROVIDERS.has(provider)) return false;
  const base = process.env.AI_BASE_URL?.trim() ?? "";
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i.test(base)) return false;
  if (/^http:\/\//i.test(base)) return false;
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      base.startsWith("https://")
  );
}

/** Daily ceiling in cents, or null when the ceiling is off. */
export function dailyBudgetCents(): number | null {
  const raw = process.env.DAILY_BUDGET_USD;
  if (raw !== undefined && raw.trim() !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }
  return cloudSpendLikely() ? 2500 : null;
}

export function budgetDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

let ready = false;

function ensure() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS spend (
      id INTEGER PRIMARY KEY,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      cents INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_spend_day ON spend(day);
  `);
  ready = true;
}

export function spentTodayCents(now = Date.now()): number {
  ensure();
  const row = db
    .prepare("SELECT COALESCE(SUM(cents), 0) AS cents FROM spend WHERE day = ?")
    .get(budgetDay(now)) as unknown as { cents: number };
  return row.cents;
}

/**
 * Count `cents` against today before the provider is called. Parallel requests
 * share one transaction, so they cannot all slip under the ceiling together.
 * A failed call is still counted: refunding it would let a retry loop spend
 * without bound.
 */
export function reserve(kind: string, cents: number, now = Date.now()): void {
  const cap = dailyBudgetCents();
  if (cap === null || cents <= 0) return;
  ensure();
  const day = budgetDay(now);
  transaction(() => {
    const row = db
      .prepare("SELECT COALESCE(SUM(cents), 0) AS cents FROM spend WHERE day = ?")
      .get(day) as unknown as { cents: number };
    if (row.cents + cents > cap) {
      const left = Math.max(0, cap - row.cents);
      throw new BudgetExceededError(
        `Daily model budget reached ($${(row.cents / 100).toFixed(2)} of $${(cap / 100).toFixed(2)}; $${(left / 100).toFixed(2)} left). Raise DAILY_BUDGET_USD, or set it to 0 to turn the ceiling off.`
      );
    }
    db.prepare("INSERT INTO spend (day, kind, cents, created_at) VALUES (?, ?, ?, ?)").run(
      day,
      kind.slice(0, 40),
      cents,
      now
    );
  });
}

export function budgetStatus(now = Date.now()) {
  const cap = dailyBudgetCents();
  const spent = cap === null ? 0 : spentTodayCents(now);
  return {
    enabled: cap !== null,
    capCents: cap,
    spentCents: spent,
    remainingCents: cap === null ? null : Math.max(0, cap - spent),
  };
}
