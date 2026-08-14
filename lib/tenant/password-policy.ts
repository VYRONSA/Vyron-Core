/**
 * Password policy — validation rules and audit redaction.
 *
 * Deliberately free of any Node-only import so the policy text and the validator can be
 * shared with the browser forms. Generation needs a CSPRNG and therefore lives in
 * lib/tenant/password-generator.ts, which is server-only.
 *
 * Passwords validated here are handed straight to Supabase Auth
 * (auth.admin.createUser / auth.admin.updateUserById). They are never written to
 * public.company_users, public.companies, an audit record, or any other table — the
 * only copy that exists after the request is the hash Supabase stores in auth.users.
 * See redactSecrets() below, which is applied to every audit payload.
 */

/** Matches the existing minimum in lib/create-client-login-user.ts. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 72; // bcrypt truncates beyond 72 bytes.

export const PASSWORD_POLICY_DESCRIPTION =
  `At least ${MIN_PASSWORD_LENGTH} characters, including an upper-case letter, a lower-case letter and a number.`;

export type PasswordValidation = { ok: true } | { ok: false; message: string };

/**
 * How an initial credential is established for a new user:
 *   "manual"   — an administrator types the password
 *   "generate" — the server mints a strong temporary password, shown once
 *   "invite"   — Supabase invitation email; the user chooses their own password
 */
export type PasswordMode = "manual" | "generate" | "invite";

/**
 * Validates a password against the application's configured requirements.
 * `confirmPassword` is optional so the same function serves both the "type it twice"
 * form and the API, which receives a single value.
 */
export function validatePassword(
  password: string,
  confirmPassword?: string
): PasswordValidation {
  const value = password || "";

  if (!value.trim()) {
    return { ok: false, message: "A password is required." };
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: `Password must be at most ${MAX_PASSWORD_LENGTH} characters.` };
  }
  if (!/[A-Z]/.test(value)) {
    return { ok: false, message: "Password must contain an upper-case letter." };
  }
  if (!/[a-z]/.test(value)) {
    return { ok: false, message: "Password must contain a lower-case letter." };
  }
  if (!/[0-9]/.test(value)) {
    return { ok: false, message: "Password must contain a number." };
  }
  if (confirmPassword !== undefined && value !== confirmPassword) {
    return { ok: false, message: "Confirm password must match the password." };
  }

  return { ok: true };
}

const SECRET_KEY_PATTERN = /pass(word)?|secret|token|credential/i;

/**
 * Strips anything password-shaped out of a value before it reaches an audit record or a
 * log line. Applied centrally in lib/tenant/user-management.ts so no individual caller
 * can forget it.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        // Keep the *fact* that a credential changed — that is the auditable event — while
        // discarding the credential itself.
        result[key] = typeof entry === "boolean" ? entry : "[redacted]";
        continue;
      }
      result[key] = redactSecrets(entry);
    }
    return result as unknown as T;
  }
  return value;
}
