/**
 * Resolves the "@/*" TypeScript path alias (tsconfig.json) for Node's built-in test
 * runner. Node 24 strips TypeScript types natively, so the suites run the real source
 * files — no build step, no transpiler dependency, no second copy of the code.
 */

import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CANDIDATE_SUFFIXES = [".ts", ".tsx", ".mjs", ".js", "", "/index.ts", "/index.tsx"];

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveWithSuffix(base, context, nextResolve) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (isFile(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = resolveWithSuffix(path.join(root, specifier.slice(2)), context, nextResolve);
    if (resolved) return resolved;
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // TypeScript sources import siblings without a file extension ("./public-env").
    // Node's ESM resolver requires one, so fill it in rather than rewriting the source.
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !specifier.startsWith(".")) throw error;

    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : root;
    const base = path.resolve(path.dirname(parentPath), specifier);
    const resolved = resolveWithSuffix(base, context, nextResolve);
    if (resolved) return resolved;
    throw error;
  }
}
