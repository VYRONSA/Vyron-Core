/**
 * Temporary-password generation. Server-only: it needs the Node CSPRNG, which is why it
 * is separate from lib/tenant/password-policy.ts (imported by browser forms).
 *
 * The generated value is returned to the caller exactly once, applied to Supabase Auth,
 * and then discarded. Nothing writes it to the database or to a log.
 */

import { randomInt } from "node:crypto";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/tenant/password-policy";

/** Ambiguous glyphs removed so a temporary password can be read aloud or copied by hand. */
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*?-_+=";
const ALL = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

function pick(alphabet: string): string {
  return alphabet[randomInt(0, alphabet.length)];
}

/**
 * Generates a strong temporary password.
 *
 * Guarantees one character from each required class so the result always satisfies
 * validatePassword(), then fills the remainder from the full alphabet and shuffles with
 * Fisher–Yates so the required characters are not always in the same positions.
 */
export function generateTemporaryPassword(length = 16): string {
  const size = Math.max(MIN_PASSWORD_LENGTH + 4, Math.min(MAX_PASSWORD_LENGTH, length));
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];

  while (chars.length < size) chars.push(pick(ALL));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
