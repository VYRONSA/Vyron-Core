import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MarketingShell from "@/components/marketing/MarketingShell";
import { getServerUser } from "@/lib/supabase-server";

export const metadata: Metadata = {
  robots: {
    index: true,
    follow: true,
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
