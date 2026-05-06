"use client";

import React from "react";

export type VyronRole =
  | "owner"
  | "admin"
  | "manager"
  | "hr"
  | "payroll"
  | "employee"
  | "viewer";

export default function RoleGuard({
  currentRole,
  allowedRoles,
  children,
  fallback,
}: {
  currentRole: VyronRole | string | null | undefined;
  allowedRoles: VyronRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const safeRole = String(currentRole || "viewer").toLowerCase();

  if (!allowedRoles.includes(safeRole as VyronRole)) {
    return (
      fallback || (
        <div className="mt-8 rounded-[28px] border border-rose-200 bg-rose-50 p-6 text-rose-800">
          <div className="text-sm font-black uppercase tracking-[0.2em]">Access blocked</div>
          <p className="mt-3 text-sm leading-6">
            You do not have permission to view this VYRON CORE module.
          </p>
        </div>
      )
    );
  }

  return <>{children}</>;
}
