import type { NextConfig } from "next";
import { assertPublicSupabaseEnvForBuild } from "./lib/public-env";

// NEXT_PUBLIC_* are inlined at build time — validate before shipping a broken auth bundle.
if (process.env.npm_lifecycle_event === "build") {
  assertPublicSupabaseEnvForBuild();
}

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, must-revalidate",
          },
        ],
      },
    ];
  },

  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/vyron-core-favicon.ico",
        permanent: false,
      },
      {
        source: "/icon-192.png",
        destination: "/vyron-core-icon-192.png",
        permanent: false,
      },
      {
        source: "/icon-512.png",
        destination: "/vyron-core-icon-512.png",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;