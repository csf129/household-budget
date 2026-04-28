"use client";

import {
  STRONG_PASSWORD_MIN_LENGTH,
  evaluatePassword,
  isPasswordStrong,
  passwordStrengthScore,
  passwordStrengthTier,
  type PasswordCriteria,
} from "@/lib/password-strength";

const LABELS: Record<
  keyof PasswordCriteria,
  { met: string; unmet: string }
> = {
  minLength: {
    met: `At least ${STRONG_PASSWORD_MIN_LENGTH} characters`,
    unmet: `At least ${STRONG_PASSWORD_MIN_LENGTH} characters`,
  },
  uppercase: {
    met: "One uppercase letter",
    unmet: "One uppercase letter",
  },
  lowercase: {
    met: "One lowercase letter",
    unmet: "One lowercase letter",
  },
  number: {
    met: "One number",
    unmet: "One number",
  },
  special: {
    met: "One special character",
    unmet: "One special character",
  },
};

const TIER_STYLES = {
  weak: {
    bar: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    width: "w-1/5",
  },
  fair: {
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    width: "w-2/5",
  },
  good: {
    bar: "bg-lime-500",
    text: "text-lime-700 dark:text-lime-400",
    width: "w-4/5",
  },
  strong: {
    bar: "bg-emerald-600",
    text: "text-emerald-700 dark:text-emerald-400",
    width: "w-full",
  },
} as const;

type Props = {
  password: string;
};

export function PasswordStrengthIndicator({ password }: Props) {
  const criteria = evaluatePassword(password);
  const score = passwordStrengthScore(criteria);
  const tier = passwordStrengthTier(score);
  const styles = TIER_STYLES[tier];
  const strong = isPasswordStrong(criteria);

  const tierLabel =
    tier === "weak"
      ? "Weak"
      : tier === "fair"
        ? "Fair"
        : tier === "good"
          ? "Good"
          : "Strong";

  return (
    <div className="space-y-3" aria-live="polite">
      <div>
        <div className="flex items-center justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
          <span>Password strength</span>
          <span className={styles.text}>{tierLabel}</span>
        </div>
        <div
          className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={5}
          aria-label={`Password strength: ${tierLabel}`}
        >
          <div
            className={`h-full rounded-full transition-all duration-200 ${styles.bar} ${styles.width}`}
          />
        </div>
      </div>

      <ul className="space-y-1.5 text-sm">
        {(Object.keys(LABELS) as (keyof PasswordCriteria)[]).map((key) => {
          const ok = criteria[key];
          return (
            <li
              key={key}
              className={`flex items-center gap-2 ${ok ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  ok
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                }`}
                aria-hidden
              >
                {ok ? "✓" : ""}
              </span>
              <span>{ok ? LABELS[key].met : LABELS[key].unmet}</span>
            </li>
          );
        })}
      </ul>

      {strong ? (
        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
          This password meets the requirements for your account.
        </p>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Complete every item above to enable account creation.
        </p>
      )}
    </div>
  );
}
