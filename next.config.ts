import type { NextConfig } from "next";
import { assertPublicSupabaseEnvForBuild } from "./lib/public-env";

if (process.env.npm_lifecycle_event === "build") {
  assertPublicSupabaseEnvForBuild();
}

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        source: "/favicon.ico",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        source: "/umora-apple-touch-icon.png",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        source: "/umora-icon-192.png",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        source: "/umora-icon-512.png",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
      {
        source: "/umora-icon-maskable-512.png",
        headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;