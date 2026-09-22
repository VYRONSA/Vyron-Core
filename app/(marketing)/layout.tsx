import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MarketingShell from "@/components/marketing/MarketingShell";
import { brand, seo } from "@/lib/marketing/umora";
import { getServerUser } from "@/lib/supabase-server";

export const metadata: Metadata = {
  // Defaults for public pages that only set a title, so no public page falls
  // back to the application's own metadata.
  description: seo.description,
  openGraph: {
    title: seo.title,
    description: seo.description,
    siteName: brand.name,
    type: "website",
  images: [
      {
        url: "/umora/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "UMORA — Human & Workforce Intelligence. Your people are your business. Make them visible.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: seo.title,
    description: seo.description,
    images: ["/umora/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [{ url: "/umora-mark.svg", type: "image/svg+xml" }],
  },
  // Public pages present the UMORA product brand; the authenticated app keeps
  // its own application name until the separate app-rebrand phase.
  applicationName: brand.name,
  appleWebApp: {
    title: brand.name,
  },
};

export default async function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user } = await getServerUser();
  if (user) {
    redirect("/dashboard");
  }

  return <MarketingShell>{children}</MarketingShell>;
}
