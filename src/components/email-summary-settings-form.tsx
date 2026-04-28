"use client";

import { useState, useCallback } from "react";
import type {
  EmailSummarySettings,
  SummaryFrequency,
  SummaryPeriod,
  SummarySections,
} from "@/types/email-summary";
import { SECTION_LABELS } from "@/types/email-summary";

type Props = {
  initial: EmailSummarySettings;
};

const FREQUENCY_OPTIONS: { value: SummaryFrequency; label: string; description: string }[] = [
  { value: "weekly", label: "Weekly", description: "Every Monday covering the current week" },
  { value: "monthly", label: "Monthly", description: "1st of the month covering the current month" },
  { value: "quarterly", label: "Quarterly", description: "1st of each quarter" },
];

const PERIOD_OPTIONS: { value: SummaryPeriod; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "quarter", label: "This quarter" },
];

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function EmailSummarySettingsForm({ initial }: Props) {
  const [recipients, setRecipients] = useState<string[]>(initial.recipients);
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [frequencies, setFrequencies] = useState<SummaryFrequency[]>(initial.frequencies);
  const [sections, setSections] = useState<SummarySections>(initial.sections);
  const [lastSentAt, setLastSentAt] = useState<string | null>(initial.last_sent_at);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [sendPeriod, setSendPeriod] = useState<SummaryPeriod>("month");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ── Recipients ─────────────────────────────────────────────────
  function addEmail() {
    const v = emailInput.trim();
    if (!v) return;
    if (!isValidEmail(v)) { setEmailError("Enter a valid email address"); return; }
    if (recipients.includes(v)) { setEmailError("Already added"); return; }
    setRecipients((prev) => [...prev, v]);
    setEmailInput("");
    setEmailError("");
  }

  function removeEmail(email: string) {
    setRecipients((prev) => prev.filter((e) => e !== email));
  }

  function onEmailKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail();
    }
  }

  // ── Sections ───────────────────────────────────────────────────
  const toggleSection = useCallback((key: keyof SummarySections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Save settings ──────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/household/email-summary/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, frequencies, sections }),
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

  // ── Send now ───────────────────────────────────────────────────
  async function handleSendNow() {
    if (recipients.length === 0) {
      setSendMsg({ type: "err", text: "Add at least one recipient before sending" });
      return;
    }
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch("/api/household/email-summary/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: sendPeriod, recipients, sections }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setSendMsg({ type: "err", text: d.error ?? "Failed to send" });
      } else {
        const now = new Date().toISOString();
        setLastSentAt(now);
        setSendMsg({ type: "ok", text: `Sent to ${recipients.join(", ")}` });
        setTimeout(() => setSendMsg(null), 6000);
      }
    } finally {
      setSending(false);
    }
  }

  const sectionKeys = Object.keys(SECTION_LABELS) as (keyof SummarySections)[];

  return (
    <div className="space-y-8">

      {/* ── Recipients ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Recipients</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Summaries will be sent to all addresses listed here.
        </p>

        {/* Chips */}
        {recipients.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {recipients.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800 dark:bg-violet-950/50 dark:text-violet-200"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
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

        {/* Input */}
        <div className="mt-3 flex gap-2">
          <input
            type="email"
            value={emailInput}
            onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
            onKeyDown={onEmailKeyDown}
            placeholder="name@example.com"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder-zinc-500"
          />
          <button
            type="button"
            onClick={addEmail}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 dark:bg-violet-700 dark:hover:bg-violet-600"
          >
            Add
          </button>
        </div>
        {emailError && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{emailError}</p>}
        <p className="mt-1.5 text-xs text-zinc-400 dark:text-zinc-500">Press Enter or comma to add multiple addresses.</p>
      </section>

      {/* ── Frequency ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Scheduled Frequency</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Choose one or more schedules. Summaries fire on Monday (weekly), the 1st (monthly), or the 1st of Jan/Apr/Jul/Oct (quarterly).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {FREQUENCY_OPTIONS.map((opt) => {
            const active = frequencies.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  setFrequencies((prev) =>
                    active ? prev.filter((f) => f !== opt.value) : [...prev, opt.value],
                  )
                }
                className={`rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? "border-violet-500 bg-violet-50 ring-1 ring-violet-500 dark:border-violet-500 dark:bg-violet-950/40"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                    active ? "border-violet-600 bg-violet-600 dark:border-violet-500 dark:bg-violet-500" : "border-zinc-300 dark:border-zinc-600"
                  }`}>
                    {active && (
                      <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                      </svg>
                    )}
                  </div>
                  <p className={`text-sm font-medium ${active ? "text-violet-800 dark:text-violet-200" : "text-zinc-800 dark:text-zinc-200"}`}>
                    {opt.label}
                  </p>
                </div>
                <p className={`mt-1.5 text-xs ${active ? "text-violet-600 dark:text-violet-400" : "text-zinc-500 dark:text-zinc-400"}`}>
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>
        {frequencies.length === 0 && (
          <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">No scheduled sends — use "Send Now" to send manually.</p>
        )}
      </section>

      {/* ── Sections ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Sections to Include</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Choose which sections appear in every summary email.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {sectionKeys.map((key) => {
            const checked = sections[key];
            return (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  checked
                    ? "border-violet-200 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30"
                    : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
                }`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                    checked
                      ? "border-violet-600 bg-violet-600 dark:border-violet-500 dark:bg-violet-500"
                      : "border-zinc-300 dark:border-zinc-600"
                  }`}
                  onClick={() => toggleSection(key)}
                >
                  {checked && (
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
                    </svg>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleSection(key)}
                  className="sr-only"
                />
                <span className={`text-sm font-medium ${checked ? "text-violet-800 dark:text-violet-200" : "text-zinc-700 dark:text-zinc-300"}`}>
                  {SECTION_LABELS[key]}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Save ────────────────────────────────────────────────── */}
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

      {/* ── Send now ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Send Now</h2>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Send a summary immediately using the settings above.
          {lastSentAt && (
            <span className="ml-1">
              Last sent {new Date(lastSentAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}.
            </span>
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setSendPeriod(opt.value)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  sendPeriod === opt.value
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSendNow}
            disabled={sending}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-violet-700 dark:hover:bg-violet-600"
          >
            {sending ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Sending…
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send Summary
              </>
            )}
          </button>
        </div>

        {sendMsg && (
          <p className={`mt-3 text-sm ${sendMsg.type === "ok" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {sendMsg.type === "ok" ? "✓ " : "⚠ "}{sendMsg.text}
          </p>
        )}
      </section>

    </div>
  );
}
