export type ResendClientInviteResult =
  | { ok: true; kind: "invite_sent" | "confirmation_resent"; message: string }
  | {
      ok: false;
      code: "already_active" | "missing_email" | "rate_limit" | "config" | "unknown";
      message: string;
    };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("rate") || m.includes("too many") || m.includes("429");
}

function looksInvalidSupabaseApiKey(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("invalid api key") ||
    m.includes("invalid_api_key") ||
    m.includes("bad_jwt") ||
    m.includes("bad jwt") ||
    m.includes("pgrst301") ||
    m.includes("3 parts in jwt") ||
    m.includes("malformed jwt")
  );
}

function looksLegacyJwtApiKey(key: string): boolean {
  return key.startsWith("eyJ");
}

/** GoTrue signup confirmation resend — use anon/publishable key only. */
async function resendSignupConfirmation(
  supabaseUrl: string,
  anonKey: string,
  email: string,
  redirectTo: string
): Promise<{ ok: boolean; message: string }> {
  const base = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/auth/v1/resend`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "signup",
      email,
      options: { email_redirect_to: redirectTo },
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as { msg?: string; error?: string; message?: string };
  const raw =
    payload.msg || payload.error || payload.message || (response.ok ? "" : `Resend failed (${response.status}).`);

  if (response.ok) {
    return { ok: true, message: "Confirmation email sent." };
  }

  const hintsInvalid =
    looksInvalidSupabaseApiKey(raw) ||
    raw.toLowerCase().includes("invalid api") ||
    response.status === 401;

  const message =
    hintsInvalid ?
      `${raw} — Confirm NEXT_PUBLIC_SUPABASE_ANON_KEY matches this project's URL. Restart Next.js after changing .env.local.`
    : raw;

  return { ok: false, message };
}

/**
 * Admin invite via raw REST (not @supabase/supabase-js admin client).
 * New dashboard `sb_secret_*` keys are not JWTs; supabase-js often breaks on them for admin methods.
 * GoTrue accepts the same key in apikey + Authorization for /auth/v1/invite.
 */
async function inviteUserViaAuthRest(
  supabaseUrl: string,
  serverSecret: string,
  email: string,
  redirectTo: string
): Promise<{ ok: boolean; message: string }> {
  const base = supabaseUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/auth/v1/invite`, {
    method: "POST",
    headers: {
      apikey: serverSecret,
      Authorization: `Bearer ${serverSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      data: {},
      redirect_to: redirectTo,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    msg?: string;
    error?: string;
    message?: string;
    error_description?: string;
  };
  const raw =
    payload.msg ||
    payload.error ||
    payload.message ||
    payload.error_description ||
    (response.ok ? "" : `Invite failed (${response.status}).`);

  if (response.ok) {
    return { ok: true, message: "Invitation queued." };
  }

  const hintsInvalid = looksInvalidSupabaseApiKey(raw) || response.status === 401 || response.status === 403;

  const message =
    hintsInvalid ?
      `${raw}`
    : raw;

  return { ok: false, message };
}

function indicatesAlreadyConfirmedFromResend(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes("already confirmed")) return true;
  if (m.includes("already verified")) return true;
  if (m.includes("address has already been confirmed")) return true;
  if (m.includes("email not confirmed")) return false;
  if (m.includes("email already confirmed")) return true;
  return false;
}

function duplicateInviteOrResendMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("already been registered") ||
    m.includes("already registered") ||
    m.includes("user already registered") ||
    m.includes("email address has already been registered") ||
    m.includes("duplicate") ||
    m.includes("user already exists") ||
    m.includes("already invited")
  );
}

function configMessageForRejectedServerKey(serverKey: string): string {
  const legacyJwt =
    'Dashboard → Project Settings → **API Keys** → open the **Legacy "anon / service_role"** tab → copy **service_role** (long string starting with `eyJ`). Put it in `.env.local` as `SUPABASE_SERVICE_ROLE_KEY=` with no quotes, save, restart Next.js.';
  const newSecret =
    "If you only have a **`sb_secret_…`** key, paste it into `SUPABASE_SECRET_KEY`. This app sends invites via **`POST /auth/v1/invite`** (REST), which works better with new secrets than `supabase-js` admin helpers.";

  if (looksLegacyJwtApiKey(serverKey)) {
    return `Supabase rejected the server API key used for invitations. Keys must be from the **same project** as \`NEXT_PUBLIC_SUPABASE_URL\`. ${legacyJwt}`;
  }

  return `Supabase rejected the server secret for **admin invite**. ${newSecret} If it still fails, use the legacy **service_role** JWT instead: ${legacyJwt}`;
}

/**
 * 1. Try signup **resend** (anon) — works for existing Auth users waiting on email confirmation; **no admin key**.
 * 2. If that fails, **invite** via REST + server secret (legacy JWT or `sb_secret_*`).
 */
export async function resendClientActivationEmail(
  email: string,
  inviteRedirectTo: string
): Promise<ResendClientInviteResult> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    return {
      ok: false,
      code: "missing_email",
      message: "A valid administrator email is required.",
    };
  }

  const stripEnvQuotes = (value: string): string => {
    const t = value.trim();
    if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
      return t.slice(1, -1).trim();
    }
    return t;
  };

  const supabaseUrl = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  const anonKey = stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "");
  const serverSecret = stripEnvQuotes(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
  );

  if (!supabaseUrl || !serverSecret) {
    return {
      ok: false,
      code: "config",
      message:
        "Server missing Supabase URL or secret. Set SUPABASE_SERVICE_ROLE_KEY (legacy service_role JWT) or SUPABASE_SECRET_KEY (sb_secret_…) for the same project as NEXT_PUBLIC_SUPABASE_URL — then restart Next.js.",
    };
  }

  if (!anonKey) {
    return {
      ok: false,
      code: "config",
      message: "Server missing NEXT_PUBLIC_SUPABASE_ANON_KEY (required to resend confirmation emails).",
    };
  }

  const redirectTo = inviteRedirectTo.trim() || `${supabaseUrl.replace(/\/+$/, "")}/signup`;

  const resendFirst = await resendSignupConfirmation(supabaseUrl, anonKey, normalizedEmail, redirectTo);
  if (resendFirst.ok) {
    return {
      ok: true,
      kind: "confirmation_resent",
      message: `Activation email sent to ${normalizedEmail}.`,
    };
  }

  if (indicatesAlreadyConfirmedFromResend(resendFirst.message)) {
    return {
      ok: false,
      code: "already_active",
      message: "This user has already confirmed their email and can sign in.",
    };
  }

  if (isRateLimitError(resendFirst.message)) {
    return {
      ok: false,
      code: "rate_limit",
      message: "Email rate limit reached. Wait a few minutes and try again.",
    };
  }

  if (
    looksInvalidSupabaseApiKey(resendFirst.message) ||
    resendFirst.message.toLowerCase().includes("invalid api")
  ) {
    return {
      ok: false,
      code: "config",
      message: resendFirst.message,
    };
  }

  const invite = await inviteUserViaAuthRest(supabaseUrl, serverSecret, normalizedEmail, redirectTo);

  if (invite.ok) {
    return {
      ok: true,
      kind: "invite_sent",
      message: `Invitation email sent to ${normalizedEmail}.`,
    };
  }

  let inviteMsg = invite.message || "Could not send invitation.";

  if (looksInvalidSupabaseApiKey(inviteMsg)) {
    return {
      ok: false,
      code: "config",
      message: configMessageForRejectedServerKey(serverSecret),
    };
  }

  if (isRateLimitError(inviteMsg)) {
    return {
      ok: false,
      code: "rate_limit",
      message: "Email rate limit reached. Wait a few minutes and try again.",
    };
  }

  if (duplicateInviteOrResendMessage(inviteMsg)) {
    const retryResend = await resendSignupConfirmation(supabaseUrl, anonKey, normalizedEmail, redirectTo);
    if (retryResend.ok) {
      return {
        ok: true,
        kind: "confirmation_resent",
        message: `Activation email resent to ${normalizedEmail}.`,
      };
    }
    if (indicatesAlreadyConfirmedFromResend(retryResend.message)) {
      return {
        ok: false,
        code: "already_active",
        message: "This user has already confirmed their email and can sign in.",
      };
    }
    if (isRateLimitError(retryResend.message)) {
      return {
        ok: false,
        code: "rate_limit",
        message: "Email rate limit reached. Wait a few minutes and try again.",
      };
    }
    return { ok: false, code: "unknown", message: retryResend.message };
  }

  return { ok: false, code: "unknown", message: inviteMsg };
}
