import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client for the *Hearth* project (the family calendar), a
 * different Supabase project than this one. Server-only: it holds Hearth's
 * service-role key, which bypasses Hearth's RLS so the finances rollup can be
 * written without a user session. It must never be imported into a client
 * component, and its key must never be exposed with a NEXT_PUBLIC_ prefix.
 *
 * This is the only bridge between the two apps, and it is one-way: we write a
 * summary in, we never read family calendar data out.
 */
export function createHearthAdminClient(): SupabaseClient {
  const url = process.env.HEARTH_SUPABASE_URL?.trim();
  const key = process.env.HEARTH_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Missing HEARTH_SUPABASE_URL or HEARTH_SERVICE_ROLE_KEY (server env only).",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
