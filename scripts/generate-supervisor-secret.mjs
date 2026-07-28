#!/usr/bin/env node
/**
 * Generates the Platform Supervisor Password hash for privilege elevation.
 *
 * The server never stores the password itself — only the scrypt hash this prints.
 * Put the hash in PLATFORM_SUPERVISOR_SECRET_HASH; keep the password in your password
 * manager and give it only to people who are allowed to run privileged platform
 * actions.
 *
 * Usage:
 *   npm run platform:supervisor-secret                  # generate a strong password + hash
 *   npm run platform:supervisor-secret -- --password "your chosen password"
 *   npm run platform:supervisor-secret -- --emergency   # label output as the secondary secret
 *
 * The hash format matches verifySupervisorPassword() in lib/platform/elevation.ts:
 *   scrypt:N:r:p:<saltBase64>:<hashBase64>
 *
 * Colon-delimited on purpose — Next.js runs dotenv-expand over .env files, which would
 * treat the `$N` in a conventional `$`-delimited hash as a variable reference and
 * corrupt the value. Base64 never contains a colon.
 */

import { randomBytes, scryptSync } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

function hash(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: 256 * 1024 * 1024,
  });
  return ["scrypt", N, R, P, salt.toString("base64"), derived.toString("base64")].join(":");
}

/** Ambiguous characters (O/0, l/1/I) removed so the password can be read aloud safely. */
function generatePassword(length = 28) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const argv = process.argv.slice(2);
const emergency = argv.includes("--emergency");
const passwordFlag = argv.indexOf("--password");
const supplied = passwordFlag !== -1 ? argv[passwordFlag + 1] : null;

if (passwordFlag !== -1 && !supplied) {
  console.error("\n  --password needs a value.\n");
  process.exit(1);
}

const password = supplied || generatePassword();
const envVar = emergency
  ? "PLATFORM_SUPERVISOR_SECRET_HASH_EMERGENCY"
  : "PLATFORM_SUPERVISOR_SECRET_HASH";

console.log(`
  VYRON CORE — Platform Supervisor Password
  =========================================

  ${supplied ? "Password (as supplied)" : "Password (generated — store it in your password manager NOW)"}:

    ${password}

  Add this to the server environment (.env.local for development, Vercel →
  Settings → Environment Variables → Production for production):

    ${envVar}=${hash(password)}

  Notes:
    - The password itself is never stored anywhere by the app, and is never sent
      to the browser. Only the hash above goes in the environment.
    - This is NOT a login password. Operators sign in normally, then enter this
      password to raise privilege for ${process.env.PLATFORM_ELEVATION_TTL_MINUTES || 30} minutes.
    - Rotating it invalidates every active Platform Mode session immediately,
      because the cookie signing key is derived from the hash.
    - Re-run with --emergency to mint a secondary break-glass secret.
`);
