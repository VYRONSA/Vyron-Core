import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enterprise guardrail: do not ship browser source maps in production (formulas stay server-side).
  // Dev keeps Next defaults (source maps for debugging). Production uses SWC minification by default.
  productionBrowserSourceMaps: false,
};

export default nextConfig;
