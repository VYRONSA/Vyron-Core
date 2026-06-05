import type { NextConfig } from "next";
import { assertPublicSupabaseEnvForBuild } from "./lib/public-env";

// NEXT_PUBLIC_* are inlined at build time — validate before shipping a broken auth bundle.
if (process.env.npm_lifecycle_event === "build") {
  assertPublicSupabaseEnvForBuild();
}

const nextConfig: NextConfig = {
  // Enterprise guardrail: do not ship browser source maps in production (formulas stay server-side).
  // Dev keeps Next defaults (source maps for debugging). Production uses SWC minification by default.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
