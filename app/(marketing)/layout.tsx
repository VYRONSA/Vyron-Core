import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import MarketingShell from "@/components/marketing/MarketingShell";
import { isTokenUsable, VYRON_AUTH_COOKIE } from "@/lib/server/auth-routing";

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
  const cookieStore = await cookies();
  const token = cookieStore.get(VYRON_AUTH_COOKIE)?.value || "";
  if (isTokenUsable(token)) {
    redirect("/dashboard");
  }

  return <MarketingShell>{children}</MarketingShell>;
}
