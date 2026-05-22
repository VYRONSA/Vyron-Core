/** Shared parsing/validation for NEXT_PUBLIC Supabase vars (build + browser). */

export function stripEnvQuotes(value: string): string {
  const t = value.trim();
  if (
    t.length >= 2 &&
    ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

export function readPublicSupabaseEnv(): { url: string; anonKey: string } {
  return {
    url: stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),
    anonKey: stripEnvQuotes(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""),
  };
}

const PLACEHOLDER_HOST_RE =
  /placeholder\.supabase\.co|YOUR_PROJECT|YOUR_SUPABASE|your-anon-key/i;

const PLACEHOLDER_ANON_RE = /^(your-anon-key|YOUR_SUPABASE_ANON_KEY)$/i;

export function validatePublicSupabaseEnv(): string[] {
  const { url, anonKey } = readPublicSupabaseEnv();
  const problems: string[] = [];

  if (!url) problems.push("NEXT_PUBLIC_SUPABASE_URL is missing or empty");
  if (!anonKey) problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or empty");

  if (url) {
    if (PLACEHOLDER_HOST_RE.test(url)) {
      problems.push("NEXT_PUBLIC_SUPABASE_URL is still a placeholder");
    }
    const normalized = url.replace(/\/+$/, "");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(normalized)) {
      problems.push(
        "NEXT_PUBLIC_SUPABASE_URL must be https://<project-ref>.supabase.co (no trailing path, no extra quotes)"
      );
    }
  }

  if (anonKey && (PLACEHOLDER_ANON_RE.test(anonKey) || PLACEHOLDER_HOST_RE.test(anonKey))) {
    problems.push("NEXT_PUBLIC_SUPABASE_ANON_KEY is still a placeholder");
  }

  return problems;
}

/** Fail `next build` early if public Supabase env would break browser auth. */
export function assertPublicSupabaseEnvForBuild(): void {
  const problems = validatePublicSupabaseEnv();
  if (problems.length === 0) return;

  throw new Error(
    [
      "Supabase public env is invalid for production build:",
      ...problems.map((p) => `  - ${p}`),
      "",
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in:",
      "  - Vercel → Project → Settings → Environment Variables → Production (then redeploy)",
      "  - or .env.production / .env.local for local builds",
      "",
      "Values are inlined at build time; a deploy without them causes browser \"Failed to fetch\" on login.",
    ].join("\n")
  );
}

export function formatSupabaseAuthErrorMessage(raw: string): string {
  const msg = raw.trim();
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) {
    return [
      "Cannot reach Supabase (network error). This usually means Production was built without",
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.",
      "Add both in Vercel → Environment Variables → Production, redeploy, then hard-refresh.",
      "Confirm the URL is https://<your-ref>.supabase.co with no surrounding quotes.",
    ].join(" ");
  }
  return msg;
}
