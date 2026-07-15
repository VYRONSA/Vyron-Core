"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { validateClientLoginPassword } from "@/lib/create-client-login-user";
import { syncVyronAuthCookies } from "@/app/_app-shell-session";

type LinkState = "checking" | "invalid" | "ready";

/** Supabase redirects an expired/used/tampered recovery or invite link back with these
 * params in the URL hash (never sent to the server, so this must run client-side). */
function readHashError(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const errorCode = params.get("error_code");
  const errorDescription = params.get("error_description");
  const error = params.get("error");
  if (!error && !errorCode && !errorDescription) return null;
  if (errorCode === "otp_expired") {
    return "This link has expired. Request a new one below.";
  }
  return errorDescription ? errorDescription.replace(/\+/g, " ") : "This link is invalid. Request a new one below.";
}

function hashLooksLikeAuthLink(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  return hash.includes("access_token") || hash.includes("error");
}

export default function ResetPasswordPage() {
  const router = useRouter();
  const [linkState, setLinkState] = useState<LinkState>("checking");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    const hashError = readHashError();
    if (hashError) {
      setLinkError(hashError);
      setLinkState("invalid");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    // detectSessionInUrl (enabled on the shared browser client) processes the recovery/
    // invite hash automatically. We don't re-implement that exchange — we just observe
    // the resulting session via getSession()/onAuthStateChange, which also covers a user
    // who already has a valid VYRON CORE session and is legitimately changing their own
    // password from this page (not only the recovery-link path).
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        sessionRef.current = data.session;
        setLinkState("ready");
        return;
      }
      if (!hashLooksLikeAuthLink()) {
        setLinkError("This page requires a valid password reset or invitation link.");
        setLinkState("invalid");
      }
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        sessionRef.current = session;
        setLinkState("ready");
      }
    });

    // If neither an existing session nor a hash-derived session shows up shortly, the
    // link is missing/malformed rather than expired (expired links come back as a hash
    // error, handled above).
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setLinkState((current) => {
        if (current === "checking") {
          setLinkError("This page requires a valid password reset or invitation link.");
          return "invalid";
        }
        return current;
      });
    }, 4000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const validationError = validateClientLoginPassword(password, confirmPassword);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setSubmitError(updateError.message);
        setSubmitting(false);
        return;
      }

      const email = data.user?.email;
      const accessToken = (await supabase.auth.getSession()).data.session?.access_token;
      if (email && accessToken) {
        syncVyronAuthCookies(email, accessToken);
      }

      setSuccess(true);
      setSubmitting(false);
      window.setTimeout(() => router.replace("/dashboard"), 1500);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not set the new password.";
      setSubmitError(message);
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-6 text-slate-950">
      <div className="w-full max-w-xl rounded-[28px] bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-cyan-700">VYRON CORE</div>
        <h1 className="mt-3 text-3xl font-black tracking-tight">Set a new password</h1>

        {linkState === "checking" && (
          <p className="mt-3 text-sm leading-6 text-slate-600">Verifying your link...</p>
        )}

        {linkState === "invalid" && (
          <>
            <div className="mt-5 rounded-2xl border-2 border-rose-600 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
              {linkError}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/forgot-password" className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300">
                Request a new link
              </Link>
              <Link href="/login" className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700">
                Return to Login
              </Link>
            </div>
          </>
        )}

        {linkState === "ready" && !success && (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Choose a new password for your VYRON CORE account.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  New password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-950 outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-950 outline-none focus:border-cyan-500"
                />
              </div>

              {submitError && (
                <div className="rounded-2xl border-2 border-rose-600 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 w-full rounded-2xl bg-[#06101f] px-5 py-4 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15 disabled:opacity-60"
              >
                {submitting ? "Saving..." : "Set new password"}
              </button>
            </form>
          </>
        )}

        {success && (
          <>
            <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">
              Password updated. Taking you to your workspace...
            </div>
            <div className="mt-6">
              <Link href="/dashboard" className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300">
                Continue to Dashboard
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
