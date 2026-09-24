import type { MetadataRoute } from "next";
import { productBrand } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: productBrand.appTitle,
    short_name: productBrand.name,
    description: productBrand.appDescription,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#04201b",
    theme_color: "#04201b",
    icons: [
      {
        src: "/umora-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/umora-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/umora-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/umora-mark.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/favicon.ico",
        sizes: "48x48",
        type: "image/x-icon",
        purpose: "any",
      },
    ],
  };
}