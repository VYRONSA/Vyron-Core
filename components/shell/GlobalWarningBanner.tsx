"use client";

type StatusItem = {
  status?: string | null;
};

type PayrollStatusItem = {
  status?: string | null;
};

type Props = {
  exceptions: StatusItem[];
  hrCases: StatusItem[];
  payrollHours: PayrollStatusItem[];
};

export default function GlobalWarningBanner({ exceptions, hrCases, payrollHours }: Props) {
  const hasIssues =
    exceptions.some((e) => e.status !== "closed" && e.status !== "approved") ||
    hrCases.some((c) => c.status !== "closed") ||
    payrollHours.some((p) => p.status === "needs_review");

  if (!hasIssues) return null;

  return (
    <div className="w-full bg-rose-600 p-4 text-center text-sm font-bold text-white">
      ⚠️ ACTION REQUIRED: Unresolved issues detected
    </div>
  );
}
