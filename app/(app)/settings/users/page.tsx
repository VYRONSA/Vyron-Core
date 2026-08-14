"use client";

/**
 * Settings → Users & Access (customer-facing).
 *
 * The page is intentionally thin: the company this screen operates on is never chosen
 * here or passed from the client. /api/company/users resolves it from the authenticated
 * session (lib/tenant/api-auth.ts), so the tenant boundary is decided on the server.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import UsersAccessPanel from "@/components/settings/UsersAccessPanel";

export default function SettingsUsersPage() {
  return (
    <main className="vyron-shell p-6 md:p-8">
      <div className="mx-auto max-w-[1800px] space-y-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition hover:bg-white/20"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Back to Command Centre
        </Link>

        <UsersAccessPanel endpoint="/api/company/users" />
      </div>
    </main>
  );
}
