/**
 * Format a detected notification event for each delivery channel.
 * All merchant labels are user/bank-controlled, so the email HTML escapes them.
 */
import type { NotificationEvent } from "@/types/notifications";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Math.abs(n));

function formatDate(iso: string): string {
  try {
    return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Short title + body for a push notification or in-app row. */
export function eventTitle(event: NotificationEvent): string {
  return event.type === "subscription_price_change"
    ? `Price change: ${event.merchantLabel}`
    : `Bill paid: ${event.merchantLabel}`;
}

export function eventBody(event: NotificationEvent): string {
  if (event.type === "subscription_price_change") {
    const prev = event.previousAmount ?? 0;
    const direction = event.amount > prev ? "up" : "down";
    return `${event.merchantLabel} changed from ${usd(prev)} to ${usd(event.amount)} (${direction}) on ${formatDate(event.occurredOn)}.`;
  }
  return `${usd(event.amount)} paid to ${event.merchantLabel} on ${formatDate(event.occurredOn)}.`;
}

/** One escaped HTML block for an event, for the notification email. */
export function eventEmailHtml(event: NotificationEvent): string {
  const title = escapeHtml(eventTitle(event));
  const body = escapeHtml(eventBody(event));
  const accent = event.type === "subscription_price_change" ? "#d97706" : "#2563eb";
  return `
    <div style="border-left:4px solid ${accent};background:#fafafa;border-radius:6px;padding:12px 16px;margin:0 0 12px;">
      <p style="margin:0;font-weight:600;color:#18181b;font-size:14px;">${title}</p>
      <p style="margin:4px 0 0;color:#52525b;font-size:13px;">${body}</p>
    </div>`;
}

export function buildNotificationEmail(householdName: string, events: NotificationEvent[]): string {
  const blocks = events.map(eventEmailHtml).join("");
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
    <h1 style="font-size:18px;color:#18181b;margin:0 0 4px;">${escapeHtml(householdName)} — Notifications</h1>
    <p style="color:#71717a;font-size:13px;margin:0 0 20px;">${events.length} new update${events.length === 1 ? "" : "s"}.</p>
    ${blocks}
  </div>`;
}
