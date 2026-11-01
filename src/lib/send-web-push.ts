/**
 * Server-side Web Push delivery. Sends a payload to every stored subscription
 * for a household and prunes endpoints the push service reports as gone.
 * Requires VAPID env vars; is a safe no-op (ok:false) when they are missing.
 */
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export type PushResult = {
  ok: boolean;
  sent: number;
  pruned: number;
  reason?: string;
};

let vapidConfigured: boolean | null = null;

function configureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const publicKey =
    process.env.VAPID_PUBLIC_KEY?.trim() || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:notifications@steward.app";
  if (!publicKey || !privateKey) {
    vapidConfigured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export async function sendPushToHousehold(
  admin: SupabaseClient,
  householdId: string,
  payload: PushPayload,
): Promise<PushResult> {
  if (!configureVapid()) {
    return { ok: false, sent: 0, pruned: 0, reason: "VAPID not configured" };
  }

  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("household_id", householdId);

  if (error) return { ok: false, sent: 0, pruned: 0, reason: error.message };
  if (!subs || subs.length === 0) return { ok: true, sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  const deadEndpoints: string[] = [];
  let sent = 0;

  await Promise.all(
    subs.map(async (row) => {
      const subscription = {
        endpoint: String(row.endpoint),
        keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
      };
      try {
        await webpush.sendNotification(subscription, body);
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404 / 410: the subscription is gone — drop it.
        if (status === 404 || status === 410) deadEndpoints.push(subscription.endpoint);
      }
    }),
  );

  if (deadEndpoints.length > 0) {
    await admin.from("push_subscriptions").delete().in("endpoint", deadEndpoints);
  }

  return { ok: true, sent, pruned: deadEndpoints.length };
}
