import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Android build output. Gradle copies Capacitor's native-bridge.js into
    // intermediates/, which is generated third-party code that no one here
    // edits - linting it only adds warnings that cannot be acted on, and makes
    // the repository's lint count depend on whether someone happened to build
    // the app. It is gitignored for the same reason.
    "android/**/build/**",
  ]),
]);

export default eslintConfig;
