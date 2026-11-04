import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared rate limit for the AI-backed endpoints. Each call spends money on a
 * model provider, so the limiter is keyed by household (the cost unit) and
 * shared across every AI route via a Postgres fixed-window counter. In-memory
 * counters are useless on serverless (each invocation is a fresh instance), so
 * the state lives in the database — see increment_ai_usage in the migration.
 */

const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW_SECONDS = 60;

export type AiRateLimitOptions = {
  /** Max requests allowed per window per household. */
  limit?: number;
  /** Window length in seconds. */
  windowSeconds?: number;
};

export type AiRateLimitResult = {
  limited: boolean;
  /** Seconds the caller should wait before retrying. */
  retryAfter: number;
};

/**
 * Bumps the household's counter for the current window and reports whether it is
 * now over the limit.
 *
 * Fails OPEN on any infrastructure error (the function not yet deployed, a
 * transient DB failure): a broken limiter must never take down a paid feature.
 * It only ever reports `limited` on an explicit over-limit count.
 */
export async function checkAiRateLimit(
  supabase: SupabaseClient,
  householdId: string,
  opts: AiRateLimitOptions = {},
): Promise<AiRateLimitResult> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;

  const { data, error } = await supabase.rpc("increment_ai_usage", {
    p_household_id: householdId,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.warn("[ai-rate-limit] check failed, allowing request:", error.message);
    return { limited: false, retryAfter: windowSeconds };
  }

  const count = typeof data === "number" ? data : Number(data);
  const limited = Number.isFinite(count) && count > limit;
  return { limited, retryAfter: windowSeconds };
}

/**
 * Route-handler guard: returns a 429 `NextResponse` when the household is over
 * its AI request limit, or `null` to continue. Call it right after resolving
 * the household, before doing any model work.
 */
export async function enforceAiRateLimit(
  supabase: SupabaseClient,
  householdId: string,
  opts: AiRateLimitOptions = {},
): Promise<NextResponse | null> {
  const { limited, retryAfter } = await checkAiRateLimit(supabase, householdId, opts);
  if (!limited) return null;
  return NextResponse.json(
    { error: "Too many AI requests. Please wait a minute and try again." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
