/** Minimum length before we call a password "strong enough" to register. */
export const STRONG_PASSWORD_MIN_LENGTH = 12;

export type PasswordCriteria = {
  minLength: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
};

export function evaluatePassword(password: string): PasswordCriteria {
  return {
    minLength: password.length >= STRONG_PASSWORD_MIN_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
}

export function isPasswordStrong(criteria: PasswordCriteria): boolean {
  return Object.values(criteria).every(Boolean);
}

/** 0–5 count of satisfied rules (for bar + label). */
export function passwordStrengthScore(criteria: PasswordCriteria): number {
  return Object.values(criteria).filter(Boolean).length;
}

export type StrengthTier = "weak" | "fair" | "good" | "strong";

export function passwordStrengthTier(score: number): StrengthTier {
  if (score <= 2) return "weak";
  if (score === 3) return "fair";
  if (score === 4) return "good";
  return "strong";
}
