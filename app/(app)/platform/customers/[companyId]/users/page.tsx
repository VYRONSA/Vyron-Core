/**
 * Platform Console → Customers → Customer → Users.
 *
 * Same screen customers use for their own workspace, pointed at the operator endpoint.
 * The Platform Console layout already enforces the operator claim and Platform Mode
 * elevation before this renders, and every endpoint re-checks both.
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import UsersAccessPanel from "@/components/settings/UsersAccessPanel";

export default async function PlatformCustomerUsersPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/platform/customers/${companyId}`}
        className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-black uppercase tracking-wide text-slate-700 transition hover:bg-slate-50"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Back to customer
      </Link>

      <UsersAccessPanel
        endpoint={`/api/platform/customers/${companyId}/users`}
        heading="Customer Users"
        subheading="Every user in this customer's workspace — administrators, roles, status, module access and last login. Actions here are audited against your operator account."
      />
    </div>
  );
}
