import type { MetadataRoute } from "next";
import { industries, siteUrl } from "@/lib/marketing/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const pages = [
    "",
    "/features",
    "/industries",
    "/pricing",
    "/solutions",
    "/about",
    "/resources",
    "/contact",
    "/login",
    "/signup",
    "/privacy",
    "/terms",
  ].map((path) => ({
    url: `${siteUrl}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.7,
  }));

  const industryPages = industries.map((industry) => ({
    url: `${siteUrl}/industries/${industry.slug}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.65,
  }));

  return [...pages, ...industryPages];
}
