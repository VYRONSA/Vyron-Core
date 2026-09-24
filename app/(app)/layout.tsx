import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/supabase-server";
import ImpersonationBanner from "@/components/platform/ImpersonationBanner";
import { umoraSans, umoraScript } from "@/components/marketing/umora/fonts";
import "../umora-app.css";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function ProtectedAppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Verified against Supabase, not a locally decoded token — the same authority
  // middleware and every route handler use.
  const { user } = await getServerUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <div className={`vyron-shell umora-app ${umoraSans.variable} ${umoraScript.variable} min-h-screen text-slate-950`}>
      <ImpersonationBanner />
      {children}
    </div>
  );
}
