"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import PlatformGlobalSearch from "@/components/platform/PlatformGlobalSearch";
import PlatformNotificationsBell from "@/components/platform/PlatformNotificationsBell";
import PlatformModeBanner from "@/components/platform/PlatformModeBanner";

const NAV_GROUPS = [
  {
    label: "Customers",
    items: [
      { href: "/platform", label: "Dashboard" },
      { href: "/platform/customers", label: "Customer Directory" },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { href: "/platform/marketplace", label: "Industry Templates" },
      { href: "/platform/plans", label: "Subscription Plans" },
      { href: "/platform/modules", label: "Module Management" },
    ],
  },
  {
    label: "Platform Intelligence",
    items: [{ href: "/platform/intelligence", label: "Executive Dashboards" }],
  },
  {
    label: "Support Centre",
    items: [{ href: "/platform/support", label: "Customer Support" }],
  },
  {
    label: "System",
    items: [{ href: "/platform/system", label: "Administration" }],
  },
];

export default function PlatformConsoleChrome({
  children,
  expiresAt,
  idleTimeoutMinutes,
  operatorEmail,
}: {
  children: React.ReactNode;
  expiresAt: string;
  idleTimeoutMinutes: number;
  operatorEmail: string;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      {/* Rendered by the console layout, so it is present on every Platform page. */}
      <PlatformModeBanner
        expiresAt={expiresAt}
        idleTimeoutMinutes={idleTimeoutMinutes}
        operatorEmail={operatorEmail}
      />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-cyan-400/30 bg-cyan-400/10 p-2.5 text-cyan-300">
            <ShieldCheck className="h-6 w-6" strokeWidth={1.8} />
          </div>
          <div>
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-400">VYRON Platform Console</div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-white">Customer & Platform Management</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PlatformGlobalSearch />
          <PlatformNotificationsBell />
        </div>
      </header>

      <nav className="flex flex-wrap gap-4 rounded-3xl bg-white/5 p-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <span className="px-3 text-[10px] font-black uppercase tracking-wider text-white/40">{group.label}</span>
            <div className="flex flex-wrap gap-1">
              {group.items.map((item) => {
                const active = item.href === "/platform" ? pathname === item.href : pathname?.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      active ? "bg-white text-[#06101f]" : "text-white/70 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <main className="flex flex-col gap-6 pb-12">{children}</main>
    </div>
  );
}
