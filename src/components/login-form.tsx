"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function isEmailNotConfirmedError(err: { message: string; code?: string }) {
  const m = err.message.toLowerCase();
  return (
    err.code === "email_not_confirmed" ||
    m.includes("email not confirmed") ||
    m.includes("confirm your email")
  );
}

function friendlySignInError(err: { message: string; code?: string }) {
  if (isEmailNotConfirmedError(err)) {
    return {
      short:
        "This email is registered, but the address is not confirmed yet. Open the link in the confirmation email, then try signing in again.",
      needsConfirmation: true as const,
    };
  }
  const m = err.message.toLowerCase();
  if (
    m.includes("invalid login") ||
    m.includes("invalid credentials") ||
    err.code === "invalid_credentials"
  ) {
    return {
      short:
        "Wrong email or password—or you may still need to confirm your email after signing up.",
      needsConfirmation: false as const,
    };
  }
  return { short: err.message, needsConfirmation: false as const };
}

function LoginFormInner() {
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(urlError);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNeedsConfirmation(false);
    setResendStatus(null);
    setLoading(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (signInError) {
      const { short, needsConfirmation: nc } = friendlySignInError(signInError);
      setError(short);
      setNeedsConfirmation(nc);
      return;
    }

    window.location.href = "/";
  }

  async function handleResendConfirmation() {
    const trimmed = email.trim();
    if (!trimmed) {
      setResendStatus("Enter your email above first.");
      return;
    }
    setResendLoading(true);
    setResendStatus(null);
    const supabase = createClient();
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email: trimmed,
      options: {
        emailRedirectTo: `${origin}/auth/callback?next=/`,
      },
    });
    setResendLoading(false);
    if (resendError) {
      setResendStatus(resendError.message);
      return;
    }
    setResendStatus("Confirmation email sent. Check your inbox and spam folder.");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          <p>{error}</p>
          {needsConfirmation ? (
            <div className="mt-3 border-t border-red-200 pt-3 dark:border-red-900/50">
              <button
                type="button"
                onClick={handleResendConfirmation}
                disabled={resendLoading}
                className="text-sm font-semibold text-red-900 underline underline-offset-2 hover:no-underline disabled:opacity-50 dark:text-red-200"
              >
                {resendLoading ? "Sending…" : "Resend confirmation email"}
              </button>
              {resendStatus ? (
                <p className="mt-2 text-sm text-red-900/90 dark:text-red-200/90">{resendStatus}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <label
          htmlFor="login-email"
          className="block text-sm font-medium text-zinc-800"
        >
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label
          htmlFor="login-password"
          className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
        >
          Password
        </label>
        <div className="relative mt-1.5">
          <input
            id="login-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 pr-24 text-zinc-900 shadow-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:ring-zinc-500/25"
          />
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-600 dark:disabled:text-zinc-300"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Need an account?{" "}
        <Link
          href="/signup"
          className="font-medium text-zinc-900 underline underline-offset-2 hover:no-underline dark:text-zinc-100"
        >
          Create one
        </Link>
      </p>
    </form>
  );
}

export function LoginForm() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>}>
      <LoginFormInner />
    </Suspense>
  );
}
