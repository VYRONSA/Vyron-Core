"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import MobileWorkforceHub from "@/components/mobile-workforce/MobileWorkforceHub";
import { getCompanyAccess } from "@/lib/company-access";
import { resolveTenantPermissionLayer } from "@/lib/tenant-rbac";
import { supabase } from "@/lib/supabase";

type EmployeeRow = {
  id: string;
  first_name: string;
  last_name: string;
  active: boolean;
};

type StoreRow = {
  id: string;
  name: string;
  gps_radius_meters: number | null;
};

export default function FieldMobilePage() {
  const [companyId, setCompanyId] = useState("");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [canAssignTasks, setCanAssignTasks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      const email = authData?.user?.email?.trim().toLowerCase() || null;

      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;

      if (accessError || !access?.company_id) {
        setError(accessError || "No company access.");
        setLoading(false);
        return;
      }

      setCompanyId(access.company_id);
      setUserEmail(email);
      const layer = resolveTenantPermissionLayer(access.user_role, email);
      setCanAssignTasks(
        layer === "owner" || layer === "admin" || layer === "manager" || layer === "supervisor"
      );

      const [employeesRes, storesRes] = await Promise.all([
        supabase
          .from("employees")
          .select("id, first_name, last_name, active")
          .eq("company_id", access.company_id)
          .eq("active", true)
          .order("first_name"),
        supabase
          .from("stores")
          .select("id, name, gps_radius_meters")
          .eq("company_id", access.company_id)
          .order("name"),
      ]);

      if (cancelled) return;

      if (employeesRes.error) {
        setError(employeesRes.error.message);
      } else {
        setEmployees((employeesRes.data || []) as EmployeeRow[]);
        setStores((storesRes.data || []) as StoreRow[]);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950">
      <div className="mx-auto max-w-lg space-y-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-bold text-cyan-800 hover:text-cyan-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to VYRON CORE
        </Link>

        {loading ? (
          <p className="text-sm font-semibold text-slate-500">Loading field mobile…</p>
        ) : error ? (
          <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">
            {error}
          </p>
        ) : (
          <MobileWorkforceHub
            companyId={companyId}
            employees={employees}
            stores={stores}
            userEmail={userEmail}
            canAssignTasks={canAssignTasks}
          />
        )}
      </div>
    </main>
  );
}
