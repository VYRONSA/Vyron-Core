"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Legacy leave kiosk URLs → canonical /leave with company param preserved. */
export default function KioskLeaveRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    router.replace(query ? `/leave?${query}` : "/leave");
  }, [router, searchParams]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f8fb] p-6 text-sm font-semibold text-slate-600">
      Opening leave kiosk…
    </main>
  );
}
