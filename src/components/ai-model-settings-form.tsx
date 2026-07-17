"use client";

import { useState } from "react";
import { AI_MODELS, INTENSITY_LABELS, type AiModelConfig } from "@/lib/ai-models";

const INTENSITY_DOTS: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };

function IntensityBadge({ level }: { level: number }) {
  const label = INTENSITY_LABELS[level] ?? "Standard";
  const colors: Record<number, string> = {
    1: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
    2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    3: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
    4: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    5: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };
  const dots = INTENSITY_DOTS[level] ?? 1;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${colors[level] ?? colors[2]}`}
    >
      {"●".repeat(dots)}{"○".repeat(5 - dots)}
      <span className="ml-1">{label}</span>
    </span>
  );
}

function ProviderBadge({ provider }: { provider: "openai" | "anthropic" }) {
  if (provider === "anthropic") {
    return (
      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
        Claude
      </span>
    );
  }
  return (
    <span className="rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
      ChatGPT
    </span>
  );
}

type Props = { initialModelId: string };

export function AiModelSettingsForm({ initialModelId }: Props) {
  const [selectedId, setSelectedId] = useState(initialModelId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentModel = AI_MODELS.find((m) => m.id === selectedId);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/household/ai-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: selectedId }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to save.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const byIntensity = AI_MODELS.reduce<Record<number, AiModelConfig[]>>((acc, m) => {
    (acc[m.intensityLevel] ??= []).push(m);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {([1, 2, 3, 4, 5] as const).map((level) => {
          const group = byIntensity[level];
          if (!group?.length) return null;
          return (
            <div key={level}>
              <div className="mb-2 flex items-center gap-2">
                <IntensityBadge level={level} />
                <span className="text-xs text-zinc-400 dark:text-zinc-500">
                  {level === 1 && "Fastest · Lowest cost"}
                  {level === 2 && "Balanced performance and cost"}
                  {level === 3 && "High accuracy · Moderate cost"}
                  {level === 4 && "Deep reasoning · Higher cost"}
                  {level === 5 && "Maximum capability · Highest cost"}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.map((model) => {
                  const isSelected = model.id === selectedId;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(model.id);
                        setSaved(false);
                        setError(null);
                      }}
                      className={`flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "border-violet-500 bg-violet-50 dark:border-violet-500 dark:bg-violet-950/30"
                          : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <span
                        className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 ${
                          isSelected
                            ? "border-violet-600 bg-violet-600"
                            : "border-zinc-400 dark:border-zinc-600"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                            {model.displayName}
                          </span>
                          <ProviderBadge provider={model.provider} />
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {model.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {currentModel?.provider === "anthropic" && (
        <p className="rounded-lg bg-orange-50 px-4 py-3 text-sm text-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
          Claude models require an <code className="rounded bg-orange-100 px-1 text-xs dark:bg-orange-900/40">ANTHROPIC_API_KEY</code>{" "}
          in your <code className="rounded bg-orange-100 px-1 text-xs dark:bg-orange-900/40">.env.local</code> file.
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved</span>
        )}
        {error && (
          <span className="text-sm text-red-600 dark:text-red-400">{error}</span>
        )}
      </div>
    </div>
  );
}
