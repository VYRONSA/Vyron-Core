import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isTokenUsable, VYRON_AUTH_COOKIE } from "@/lib/server/auth-routing";

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
  const cookieStore = await cookies();
  const token = cookieStore.get(VYRON_AUTH_COOKIE)?.value || "";
  if (!isTokenUsable(token)) {
    redirect("/login");
  }

  return (
    <div className="vyron-shell min-h-screen bg-[#07101f] text-slate-950">
      {children}
    </div>
  );
}
