"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CardInsights,
  CreditCardMetadataInput,
  CreditCardStatus,
  CreditCardView,
} from "@/types/credit-card";
import { buildCardReminders } from "@/lib/credit-card-reminders";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtMoney(n: number | null, currency = "USD"): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function fmtPoints(n: number | null): string {
  return n === null ? "—" : new Intl.NumberFormat("en-US").format(n);
}

const STATUS_BADGE: Record<CreditCardStatus, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  cancelled: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_LABEL: Record<CreditCardStatus, string> = {
  active: "Active",
  review: "Reviewing",
  cancelled: "Cancelled",
};

const URGENCY_STYLES: Record<string, string> = {
  overdue: "border-red-300 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
  soon: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
  upcoming: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
};

function duePhrase(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `in ${days} days`;
}

type FormState = {
  annualFee: string;
  annualFeeMonth: string;
  paymentDueDay: string;
  pointsProgram: string;
  pointsBalance: string;
  rewardSummary: string;
  status: CreditCardStatus;
  notes: string;
};

function toForm(card: CreditCardView): FormState {
  return {
    annualFee: card.annualFee != null ? String(card.annualFee) : "",
    annualFeeMonth: card.annualFeeMonth != null ? String(card.annualFeeMonth) : "",
    paymentDueDay: card.paymentDueDay != null ? String(card.paymentDueDay) : "",
    pointsProgram: card.pointsProgram ?? "",
    pointsBalance: card.pointsBalance != null ? String(card.pointsBalance) : "",
    rewardSummary: card.rewardSummary ?? "",
    status: card.status,
    notes: card.notes ?? "",
  };
}

export function CreditCardsManager({
  initialCards,
}: {
  initialCards: CreditCardView[];
}) {
  const router = useRouter();
  const [cards, setCards] = useState<CreditCardView[]>(initialCards);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [insights, setInsights] = useState<CardInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  const reminders = useMemo(() => buildCardReminders(cards), [cards]);

  function startEdit(card: CreditCardView) {
    setEditingId(card.id);
    setForm(toForm(card));
    setSaveError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(null);
    setSaveError(null);
  }

  async function saveEdit(card: CreditCardView) {
    if (!form) return;
    setSaving(true);
    setSaveError(null);

    const payload: CreditCardMetadataInput = {
      bankAccountId: card.id,
      annualFee: form.annualFee.trim() === "" ? null : Number(form.annualFee),
      annualFeeMonth: form.annualFeeMonth === "" ? null : Number(form.annualFeeMonth),
      paymentDueDay: form.paymentDueDay.trim() === "" ? null : Number(form.paymentDueDay),
      pointsProgram: form.pointsProgram.trim() || null,
      pointsBalance: form.pointsBalance.trim() === "" ? null : Number(form.pointsBalance),
      pointsUpdatedOn: form.pointsBalance.trim() === "" ? null : new Date().toISOString().slice(0, 10),
      rewardSummary: form.rewardSummary.trim() || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    try {
      const res = await fetch("/api/household/credit-cards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveError(data.error ?? "Failed to save.");
        return;
      }
      setCards((prev) =>
        prev.map((c) =>
          c.id === card.id
            ? {
                ...c,
                annualFee: payload.annualFee,
                annualFeeMonth: payload.annualFeeMonth,
                paymentDueDay: payload.paymentDueDay,
                pointsProgram: payload.pointsProgram,
                pointsBalance: payload.pointsBalance,
                pointsUpdatedOn: payload.pointsUpdatedOn,
                rewardSummary: payload.rewardSummary,
                status: payload.status,
                notes: payload.notes,
              }
            : c,
        ),
      );
      cancelEdit();
      router.refresh();
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function loadInsights() {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const res = await fetch("/api/household/credit-cards/insights", { method: "POST" });
      const data = (await res.json()) as { insights?: CardInsights; error?: string };
      if (!res.ok || !data.insights) {
        setInsightsError(data.error ?? "Could not generate insights.");
        return;
      }
      setInsights(data.insights);
    } catch {
      setInsightsError("Network error. Please try again.");
    } finally {
      setInsightsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Credit Cards
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Balances, due dates, points, and renewal reminders for your linked credit cards.
        </p>
      </div>

      {/* Reminders */}
      {reminders.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Reminders
          </h2>
          <ul className="space-y-2">
            {reminders.map((r) => (
              <li
                key={`${r.cardId}:${r.kind}`}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm ${URGENCY_STYLES[r.urgency]}`}
              >
                <span className="font-medium">
                  {r.kind === "payment_due" ? "Payment" : "Annual fee renews"} · {r.cardName}
                </span>
                <span>
                  {r.kind === "payment_due"
                    ? `Payment ${duePhrase(r.daysUntil)} (${r.date})`
                    : `Renews ${r.date} — ${r.daysUntil} day${r.daysUntil === 1 ? "" : "s"} to cancel if unwanted`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* AI insights */}
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Points & optimization insights
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              General guidance from your cards + spending. Not a live offer feed — check each issuer&apos;s app for current promotions.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadInsights()}
            disabled={insightsLoading}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {insightsLoading ? "Analyzing…" : insights ? "Refresh insights" : "Get AI insights"}
          </button>
        </div>

        {insightsError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{insightsError}</p>
        )}

        {insights && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {insights.perCategory.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Best card per category
                </h3>
                <ul className="space-y-1.5">
                  {insights.perCategory.map((p, i) => (
                    <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{p.category}:</span>{" "}
                      {p.recommendedCard}
                      {p.why ? <span className="text-zinc-500 dark:text-zinc-400"> — {p.why}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insights.verdicts.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Keep or cancel
                </h3>
                <ul className="space-y-1.5">
                  {insights.verdicts.map((v, i) => (
                    <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{v.card}:</span>{" "}
                      <span className="uppercase">{v.verdict}</span>
                      {v.reasoning ? <span className="text-zinc-500 dark:text-zinc-400"> — {v.reasoning}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insights.underusedCards.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Underused cards
                </h3>
                <ul className="space-y-1.5">
                  {insights.underusedCards.map((u, i) => (
                    <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{u.card}:</span>{" "}
                      {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insights.tips.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Tips
                </h3>
                <ul className="list-disc space-y-1 pl-5">
                  {insights.tips.map((t, i) => (
                    <li key={i} className="text-sm text-zinc-700 dark:text-zinc-300">{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => {
          const isEditing = editingId === card.id && form;
          return (
            <div
              key={card.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                    {card.name}
                    {card.mask ? (
                      <span className="ml-1 font-normal text-zinc-400">···{card.mask}</span>
                    ) : null}
                  </p>
                  {card.pointsProgram ? (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{card.pointsProgram}</p>
                  ) : null}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[card.status]}`}>
                  {STATUS_LABEL[card.status]}
                </span>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Balance owed</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                    {fmtMoney(card.currentBalance, card.isoCurrencyCode ?? "USD")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Available credit</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                    {fmtMoney(card.availableBalance, card.isoCurrencyCode ?? "USD")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Payment due day</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                    {card.paymentDueDay != null ? `Day ${card.paymentDueDay}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Points balance</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">{fmtPoints(card.pointsBalance)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Annual fee</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">{fmtMoney(card.annualFee)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-zinc-500 dark:text-zinc-400">Renews</dt>
                  <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                    {card.annualFeeMonth != null ? MONTHS[card.annualFeeMonth - 1] : "—"}
                  </dd>
                </div>
              </dl>

              {card.rewardSummary ? (
                <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">Rewards: </span>
                  {card.rewardSummary}
                </p>
              ) : null}

              {card.status === "cancelled" ? (
                <p className="mt-3 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  Marked cancelled. To stop syncing this card, unlink it in{" "}
                  <a href="/settings/bank" className="underline">Settings → Bank</a>. Cancellation itself is done with the issuer.
                </p>
              ) : null}

              {isEditing ? (
                <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Annual fee ($)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.annualFee}
                        onChange={(e) => setForm({ ...form, annualFee: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Renewal month
                      <select
                        value={form.annualFeeMonth}
                        onChange={(e) => setForm({ ...form, annualFeeMonth: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      >
                        <option value="">—</option>
                        {MONTHS.map((m, i) => (
                          <option key={m} value={i + 1}>{m}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Payment due day
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={form.paymentDueDay}
                        onChange={(e) => setForm({ ...form, paymentDueDay: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Points balance
                      <input
                        type="number"
                        min="0"
                        value={form.pointsBalance}
                        onChange={(e) => setForm({ ...form, pointsBalance: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      />
                    </label>
                  </div>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Points program
                    <input
                      type="text"
                      value={form.pointsProgram}
                      placeholder="e.g. Chase Ultimate Rewards"
                      onChange={(e) => setForm({ ...form, pointsProgram: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Reward structure
                    <input
                      type="text"
                      value={form.rewardSummary}
                      placeholder="e.g. 3x dining, 2x travel, 1x everything else"
                      onChange={(e) => setForm({ ...form, rewardSummary: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Status
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value as CreditCardStatus })}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    >
                      <option value="active">Active — keeping it</option>
                      <option value="review">Reviewing — deciding whether to cancel</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Notes
                    <textarea
                      value={form.notes}
                      rows={2}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                  </label>

                  {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveEdit(card)}
                      disabled={saving}
                      className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(card)}
                  className="mt-4 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Edit details
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
