"use client";

import { useEffect, useState } from "react";
import type { NotificationSettings } from "@/types/notifications";
import {
  isPushSupported,
  isPushConfigured,
  getExistingSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/web-push-client";

type Props = {
  initial: NotificationSettings;
  canEdit: boolean;
};

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
  description: string;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-4 rounded-lg border p-4 ${
        checked
          ? "border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30"
          : "border-zinc-200 dark:border-zinc-700"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
    >
      <div className="min-w-0">
        <p className={`text-sm font-medium ${checked ? "text-violet-800 dark:text-violet-200" : "text-zinc-800 dark:text-zinc-200"}`}>
          {label}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-violet-600 dark:bg-violet-500" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}

export function NotificationSettingsForm({ initial, canEdit }: Props) {
  const [notifyWebPush, setNotifyWebPush] = useState(initial.notifyWebPush);
  const [notifyInApp, setNotifyInApp] = useState(initial.notifyInApp);
  const [notifyEmail, setNotifyEmail] = useState(initial.notifyEmail);
  const [recipients, setRecipients] = useState<string[]>(initial.emailRecipients);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [priceChangeEnabled, setPriceChangeEnabled] = useState(initial.priceChangeEnabled);
  const [billPaidEnabled, setBillPaidEnabled] = useState(initial.billPaidEnabled);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // Per-device push subscription state.
  const [pushState, setPushState] = useState<"loading" | "unsupported" | "unconfigured" | "on" | "off">("loading");
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [deviceMsg, setDeviceMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isPushSupported()) {
      setPushState("unsupported");
      return;
    }
    if (!isPushConfigured()) {
      setPushState("unconfigured");
      return;
    }
    getExistingSubscription().then((sub) => setPushState(sub ? "on" : "off"));
  }, []);

  function addEmail() {
    const v = emailInput.trim();
    if (!v) return;
    if (!isValidEmail(v)) { setEmailError("Enter a valid email address"); return; }
    if (recipients.includes(v)) { setEmailError("Already added"); return; }
    setRecipients((prev) => [...prev, v]);
    setEmailInput("");
    setEmailError("");
  }

  async function handleEnableDevice() {
    setDeviceBusy(true);
    setDeviceMsg(null);
    const res = await subscribeToPush();
    setDeviceBusy(false);
    if (res.ok) {
      setPushState("on");
      setDeviceMsg("This device will now receive push notifications.");
    } else {
      setDeviceMsg(res.error ?? "Could not enable push on this device.");
    }
  }

  async function handleDisableDevice() {
    setDeviceBusy(true);
    setDeviceMsg(null);
    const res = await unsubscribeFromPush();
    setDeviceBusy(false);
    if (res.ok) {
      setPushState("off");
      setDeviceMsg("This device will no longer receive push notifications.");
    } else {
      setDeviceMsg(res.error ?? "Could not disable push on this device.");
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/household/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifyWebPush,
          notifyInApp,
          notifyEmail,
          emailRecipients: recipients,
          priceChangeEnabled,
          billPaidEnabled,
        }),
      });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        setSaveMsg({ type: "err", text: d.error ?? "Failed to save" });
      } else {
        setSaveMsg({ type: "ok", text: "Settings saved" });
        setTimeout(() => setSaveMsg(null), 3000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Events to watch ─────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">What to notify about</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Recurring merchants are detected automatically from your transaction history.
        </p>
        <div className="mt-4 grid gap-3">
          <Toggle
            checked={priceChangeEnabled}
            onChange={setPriceChangeEnabled}
            disabled={!canEdit}
            label="Subscription price changes"
            description="When a recurring charge posts at a noticeably different amount than before."
          />
          <Toggle
            checked={billPaidEnabled}
            onChange={setBillPaidEnabled}
            disabled={!canEdit}
            label="Bills paid"
            description="When a recurring bill is paid — includes the amount and the date."
          />
        </div>
      </section>

      {/* ── Channels ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">How to notify</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Turn each delivery channel on or off for the whole household.
        </p>
        <div className="mt-4 grid gap-3">
          <Toggle
            checked={notifyWebPush}
            onChange={setNotifyWebPush}
            disabled={!canEdit}
            label="Web push"
            description="Push notifications to devices that have opted in below. Works best when the app is installed to your home screen."
          />

          {/* Per-device push enrollment */}
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
            {pushState === "loading" && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Checking this device…</p>
            )}
            {pushState === "unsupported" && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                This browser doesn&apos;t support web push. On iPhone/iPad, add the app to your Home Screen first.
              </p>
            )}
            {pushState === "unconfigured" && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Web push isn&apos;t configured on the server yet (missing VAPID keys).
              </p>
            )}
            {(pushState === "on" || pushState === "off") && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-zinc-600 dark:text-zinc-300">
                  {pushState === "on"
                    ? "This device is receiving push notifications."
                    : "This device is not yet receiving push notifications."}
                </p>
                <button
                  type="button"
                  onClick={pushState === "on" ? handleDisableDevice : handleEnableDevice}
                  disabled={deviceBusy}
                  className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
                >
                  {deviceBusy ? "Working…" : pushState === "on" ? "Disable on this device" : "Enable on this device"}
                </button>
              </div>
            )}
            {deviceMsg && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{deviceMsg}</p>}
          </div>

          <Toggle
            checked={notifyInApp}
            onChange={setNotifyInApp}
            disabled={!canEdit}
            label="In-app alerts"
            description="Show events on the Alerts page. Always available, no setup required."
          />
          <Toggle
            checked={notifyEmail}
            onChange={setNotifyEmail}
            disabled={!canEdit}
            label="Email"
            description="Email the recipients below. Requires a configured RESEND_API_KEY."
          />

          {notifyEmail && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/40">
              {recipients.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {recipients.map((email) => (
                    <span
                      key={email}
                      className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800 dark:bg-violet-950/50 dark:text-violet-200"
                    >
                      {email}
                      <button
                        type="button"
                        onClick={() => setRecipients((prev) => prev.filter((e) => e !== email))}
                        className="rounded-full p-0.5 hover:bg-violet-200 dark:hover:bg-violet-800"
                        aria-label={`Remove ${email}`}
                      >
                        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2}>
                          <path d="M2 2l8 8M10 2l-8 8" />
                        </svg>
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={emailInput}
                  disabled={!canEdit}
                  onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addEmail(); } }}
                  placeholder="name@example.com"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
                />
                <button
                  type="button"
                  onClick={addEmail}
                  disabled={!canEdit}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
                >
                  Add
                </button>
              </div>
              {emailError && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{emailError}</p>}
            </div>
          )}
        </div>
      </section>

      {/* ── Save ────────────────────────────────────────────────── */}
      {canEdit ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
          {saveMsg && (
            <p className={`text-sm ${saveMsg.type === "ok" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {saveMsg.text}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Only a household head can change these settings. You can still enable push on your own device above.
        </p>
      )}
    </div>
  );
}
