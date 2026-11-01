/** Kinds of notification events the detector can produce. */
export type NotificationEventType = "subscription_price_change" | "bill_paid";

/** Per-household notification preferences. */
export type NotificationSettings = {
  notifyWebPush: boolean;
  notifyInApp: boolean;
  notifyEmail: boolean;
  emailRecipients: string[];
  priceChangeEnabled: boolean;
  billPaidEnabled: boolean;
  lastRunAt: string | null;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  notifyWebPush: true,
  notifyInApp: true,
  notifyEmail: false,
  emailRecipients: [],
  priceChangeEnabled: true,
  billPaidEnabled: true,
  lastRunAt: null,
};

/**
 * A detected event, ready to record / dispatch. `dedupKey` makes a given
 * event idempotent across cron runs (one price change / one bill payment).
 */
export type NotificationEvent = {
  type: NotificationEventType;
  dedupKey: string;
  /** Normalized merchant used for grouping. */
  merchant: string;
  /** Human-facing merchant label. */
  merchantLabel: string;
  amount: number;
  /** Prior baseline amount — price-change events only. */
  previousAmount: number | null;
  occurredOn: string;
  categoryId: string | null;
};

/** A persisted event row (what the in-app feed reads). */
export type NotificationEventRecord = NotificationEvent & {
  id: string;
  createdAt: string;
  deliveredWebPush: boolean;
  deliveredEmail: boolean;
};

/** A stored Web Push subscription (serialized PushSubscription). */
export type StoredPushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};
