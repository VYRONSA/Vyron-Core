/**
 * Request-value coercions for the Road & Recovery API surface.
 *
 * Split out of api.ts so they can be unit-tested: that module imports
 * `next/server`, which the test loader cannot resolve. These are pure and have
 * no runtime dependencies, so the tests exercise the exact expressions the
 * route handlers use rather than a copy of them.
 */

export function asText(value: unknown): string {
  return String(value ?? "").trim();
}

export function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Deliberately strict. Only a real `true` (or the string "true") counts.
 *
 * Safety flags are read through this: a driver reads an absent warning as "no
 * casualty", so an ambiguous value must never become a warning, and a genuine
 * warning must never be lost to a loose truthiness check.
 */
export function asBooleanOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  return value === true || value === "true";
}
