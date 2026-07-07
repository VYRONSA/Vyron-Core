"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  RefreshCcw,
  RotateCcw,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";
import AdvancedEmployeeGlobalSearch from "@/components/AdvancedEmployeeGlobalSearch";
import EmployeeImportWizard from "@/components/EmployeeImportWizard";
import EmployeeDocumentVaultPanel from "@/components/EmployeeDocumentVaultPanel";
import WorkforceMovementPanel from "@/components/WorkforceMovementPanel";
import EmployeeEnterpriseEnhancementsPanel from "@/components/EmployeeEnterpriseEnhancementsPanel";

type StoreRow = {
  id: string;
  name: string;
};

type EmployeeRow = {
  id: string;
  company_id?: string | null;
  employee_number: string | null;
  first_name: string;
  last_name: string;
  job_title: string | null;
  default_store_id: string | null;
  active: boolean;
  email: string | null;
  phone: string | null;
  employment_type: string | null;
  pin_code?: string | null;
  kiosk_access_enabled?: boolean | null;
};

type EmployeeProfileRow = {
  personal_information?: Record<string, unknown> | null;
  employment_information?: Record<string, unknown> | null;
  company_information?: Record<string, unknown> | null;
  department?: string | null;
  position?: string | null;
  supervisor?: string | null;
  employment_status?: string | null;
  contact_details?: Record<string, unknown> | null;
  emergency_contacts?: Record<string, unknown> | null;
  next_of_kin?: Record<string, unknown> | null;
  identification?: Record<string, unknown> | null;
  payroll_information?: Record<string, unknown> | null;
  clocking_information?: Record<string, unknown> | null;
  training?: Record<string, unknown> | null;
  notes?: string | null;
};

type TabKey = "profile" | "search" | "import" | "documents" | "movement" | "enterprise";

function employeeName(employee: EmployeeRow) {
  return `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
}

function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
        active ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function jsonToText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const typed = value as Record<string, unknown>;
  if (typeof typed.text === "string") return typed.text;
  return JSON.stringify(value, null, 2);
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-sm font-bold text-slate-800">
      {label}
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
      />
    </label>
  );
}

export default function EmployeesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("profile");
  const [companyId, setCompanyId] = useState("");
  const [userRole, setUserRole] = useState("employee");
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [employeeNumber, setEmployeeNumber] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [defaultStoreId, setDefaultStoreId] = useState("");
  const [employmentType, setEmploymentType] = useState("permanent");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [kioskEnabled, setKioskEnabled] = useState(true);
  const [activeStatus, setActiveStatus] = useState(true);

  const [createFirstName, setCreateFirstName] = useState("");
  const [createLastName, setCreateLastName] = useState("");
  const [createEmployeeNumber, setCreateEmployeeNumber] = useState("");
  const [createJobTitle, setCreateJobTitle] = useState("");
  const [createStoreId, setCreateStoreId] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createEmploymentType, setCreateEmploymentType] = useState("permanent");
  const [createPinCode, setCreatePinCode] = useState("");

  const [profilePersonalInformation, setProfilePersonalInformation] = useState("");
  const [profileEmploymentInformation, setProfileEmploymentInformation] = useState("");
  const [profileCompanyInformation, setProfileCompanyInformation] = useState("");
  const [profileDepartment, setProfileDepartment] = useState("");
  const [profilePosition, setProfilePosition] = useState("");
  const [profileSupervisor, setProfileSupervisor] = useState("");
  const [profileEmploymentStatus, setProfileEmploymentStatus] = useState("");
  const [profileContactDetails, setProfileContactDetails] = useState("");
  const [profileEmergencyContacts, setProfileEmergencyContacts] = useState("");
  const [profileNextOfKin, setProfileNextOfKin] = useState("");
  const [profileIdentification, setProfileIdentification] = useState("");
  const [profilePayrollInformation, setProfilePayrollInformation] = useState("");
  const [profileClockingInformation, setProfileClockingInformation] = useState("");
  const [profileTraining, setProfileTraining] = useState("");
  const [profileNotes, setProfileNotes] = useState("");

  const [documentsCount, setDocumentsCount] = useState(0);
  const [warningsCount, setWarningsCount] = useState(0);
  const [hrCasesCount, setHrCasesCount] = useState(0);
  const [leaveCount, setLeaveCount] = useState(0);
  const [attendanceCount, setAttendanceCount] = useState(0);

  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedEmployee = employees.find((item) => item.id === selectedEmployeeId) || null;

  const isOwner = useMemo(() => {
    const role = (userRole || "").toLowerCase();
    return role === "owner" || role === "super_admin";
  }, [userRole]);

  const canManageEmployees = useMemo(() => {
    const role = (userRole || "").toLowerCase();
    return ["owner", "super_admin", "admin", "manager", "supervisor"].includes(role);
  }, [userRole]);

  const filteredEmployees = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return employees;
    return employees.filter((employee) => {
      const text = [
        employee.employee_number || "",
        employee.first_name || "",
        employee.last_name || "",
        employee.job_title || "",
        employee.email || "",
        employee.phone || "",
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(term);
    });
  }, [employees, search]);

  const activeCount = useMemo(
    () => employees.filter((employee) => employee.active !== false).length,
    [employees]
  );

  const inactiveCount = useMemo(
    () => employees.filter((employee) => employee.active === false).length,
    [employees]
  );

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      const { access, error: accessError } = await getCompanyAccess(supabase);
      if (cancelled) return;

      if (accessError || !access?.company_id) {
        setError(accessError || "No company access.");
        setLoading(false);
        return;
      }

      setCompanyId(access.company_id);
      setUserRole(access.user_role || "employee");
      await loadData(access.company_id);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedEmployee) return;
    setEmployeeNumber(selectedEmployee.employee_number || "");
    setFirstName(selectedEmployee.first_name || "");
    setLastName(selectedEmployee.last_name || "");
    setJobTitle(selectedEmployee.job_title || "");
    setDefaultStoreId(selectedEmployee.default_store_id || "");
    setEmploymentType(selectedEmployee.employment_type || "permanent");
    setPhone(selectedEmployee.phone || "");
    setEmail(selectedEmployee.email || "");
    setPinCode(selectedEmployee.pin_code || "");
    setKioskEnabled(selectedEmployee.kiosk_access_enabled !== false);
    setActiveStatus(selectedEmployee.active !== false);
    setMessage(null);
    setError(null);
  }, [selectedEmployee]);

  useEffect(() => {
    if (!selectedEmployeeId || !companyId) return;
    void loadEmployeeProfile(selectedEmployeeId);
  }, [selectedEmployeeId, companyId]);

  async function loadEmployeeProfile(employeeId: string) {
    const [profileResult, documentsResult, warningsResult, hrCasesResult, leaveResult, attendanceResult] =
      await Promise.all([
        supabase
          .from("employee_profiles")
          .select(
            "personal_information,employment_information,company_information,department,position,supervisor,employment_status,contact_details,emergency_contacts,next_of_kin,identification,payroll_information,clocking_information,training,notes"
          )
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .maybeSingle(),
        supabase
          .from("employee_documents")
          .select("id", { head: true, count: "exact" })
          .eq("company_id", companyId)
          .eq("employee_id", employeeId),
        supabase
          .from("hr_warnings")
          .select("id", { head: true, count: "exact" })
          .eq("company_id", companyId)
          .eq("employee_id", employeeId),
        supabase
          .from("hr_cases")
          .select("id", { head: true, count: "exact" })
          .eq("company_id", companyId)
          .eq("employee_id", employeeId),
        supabase
          .from("leave_requests")
          .select("id", { head: true, count: "exact" })
          .eq("company_id", companyId)
          .eq("employee_id", employeeId),
        supabase
          .from("clock_events")
          .select("id", { head: true, count: "exact" })
          .eq("company_id", companyId)
          .eq("employee_id", employeeId),
      ]);

    if (profileResult.error && profileResult.error.code !== "PGRST205") {
      setError(profileResult.error.message);
      return;
    }

    if (profileResult.error?.code === "PGRST205") {
      setError("employee_profiles table not found. Run sql/042-employee-management-profiles.sql");
    }

    const profile = (profileResult.data || null) as EmployeeProfileRow | null;
    setProfilePersonalInformation(jsonToText(profile?.personal_information));
    setProfileEmploymentInformation(jsonToText(profile?.employment_information));
    setProfileCompanyInformation(jsonToText(profile?.company_information));
    setProfileDepartment(profile?.department || "");
    setProfilePosition(profile?.position || "");
    setProfileSupervisor(profile?.supervisor || "");
    setProfileEmploymentStatus(profile?.employment_status || "");
    setProfileContactDetails(jsonToText(profile?.contact_details));
    setProfileEmergencyContacts(jsonToText(profile?.emergency_contacts));
    setProfileNextOfKin(jsonToText(profile?.next_of_kin));
    setProfileIdentification(jsonToText(profile?.identification));
    setProfilePayrollInformation(jsonToText(profile?.payroll_information));
    setProfileClockingInformation(jsonToText(profile?.clocking_information));
    setProfileTraining(jsonToText(profile?.training));
    setProfileNotes(profile?.notes || "");

    setDocumentsCount(documentsResult.count || 0);
    setWarningsCount(warningsResult.count || 0);
    setHrCasesCount(hrCasesResult.count || 0);
    setLeaveCount(leaveResult.count || 0);
    setAttendanceCount(attendanceResult.count || 0);
  }

  async function saveEmployeeProfileSections() {
    if (!selectedEmployee) {
      setError("Select an employee first.");
      return;
    }
    if (!canManageEmployees) {
      setError("You do not have permission to update employee profile sections.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const payload = {
      company_id: companyId,
      employee_id: selectedEmployee.id,
      personal_information: { text: profilePersonalInformation.trim() },
      employment_information: { text: profileEmploymentInformation.trim() },
      company_information: { text: profileCompanyInformation.trim() },
      department: profileDepartment.trim() || null,
      store_id: defaultStoreId || null,
      position: profilePosition.trim() || null,
      supervisor: profileSupervisor.trim() || null,
      employment_status: profileEmploymentStatus.trim() || null,
      contact_details: { text: profileContactDetails.trim() },
      emergency_contacts: { text: profileEmergencyContacts.trim() },
      next_of_kin: { text: profileNextOfKin.trim() },
      identification: { text: profileIdentification.trim() },
      payroll_information: { text: profilePayrollInformation.trim() },
      clocking_information: { text: profileClockingInformation.trim() },
      training: { text: profileTraining.trim() },
      notes: profileNotes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from("employee_profiles")
      .upsert(payload, { onConflict: "company_id,employee_id" });

    if (upsertError) {
      setError(upsertError.message);
      setSaving(false);
      return;
    }

    await supabase.from("employee_audit_history").insert({
      company_id: companyId,
      employee_id: selectedEmployee.id,
      action: "profile_sections_saved",
      details: {
        saved_at: new Date().toISOString(),
        sections: [
          "personal_information",
          "employment_information",
          "company_information",
          "department",
          "store",
          "position",
          "supervisor",
          "employment_status",
          "contact_details",
          "emergency_contacts",
          "next_of_kin",
          "identification",
          "payroll_information",
          "clocking_information",
          "training",
          "notes",
        ],
      },
    });

    setMessage("Employee profile sections saved.");
    setSaving(false);
  }

  async function loadData(activeCompanyId: string) {
    setLoading(true);
    setError(null);

    const [employeesResult, storesResult] = await Promise.all([
      supabase
        .from("employees")
        .select(
          "id,company_id,employee_number,first_name,last_name,job_title,default_store_id,active,email,phone,employment_type,pin_code,kiosk_access_enabled"
        )
        .eq("company_id", activeCompanyId)
        .order("first_name", { ascending: true }),
      supabase
        .from("stores")
        .select("id,name")
        .eq("company_id", activeCompanyId)
        .order("name", { ascending: true }),
    ]);

    if (employeesResult.error) {
      setError(employeesResult.error.message);
      setLoading(false);
      return;
    }
    if (storesResult.error) {
      setError(storesResult.error.message);
      setLoading(false);
      return;
    }

    const loadedEmployees = (employeesResult.data || []) as EmployeeRow[];
    setEmployees(loadedEmployees);
    setStores((storesResult.data || []) as StoreRow[]);

    if (!selectedEmployeeId && loadedEmployees.length > 0) {
      setSelectedEmployeeId(loadedEmployees[0].id);
    }

    setLoading(false);
  }

  function generatePin() {
    setPinCode(String(Math.floor(1000 + Math.random() * 9000)));
  }

  async function saveEmployee() {
    if (!canManageEmployees) {
      setError("You do not have permission to update employees.");
      return;
    }

    if (!selectedEmployee) {
      setError("Select an employee first.");
      return;
    }

    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }

    if (pinCode.trim() && !/^\d{4}$/.test(pinCode.trim())) {
      setError("PIN must be exactly 4 numbers.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("employees")
      .update({
        employee_number: employeeNumber.trim() || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        job_title: jobTitle.trim() || null,
        default_store_id: defaultStoreId || null,
        employment_type: employmentType || "permanent",
        phone: phone.trim() || null,
        email: email.trim() || null,
        pin_code: pinCode.trim() || null,
        kiosk_access_enabled: kioskEnabled,
        active: activeStatus,
      })
      .eq("id", selectedEmployee.id)
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    setMessage("Employee updated successfully.");
    setSaving(false);
    await loadData(companyId);
  }

  async function createEmployee() {
    if (!canManageEmployees) {
      setError("You do not have permission to create employees.");
      return;
    }
    if (!createFirstName.trim() || !createLastName.trim()) {
      setError("First name and last name are required for new employee.");
      return;
    }
    if (createPinCode.trim() && !/^\d{4}$/.test(createPinCode.trim())) {
      setError("New employee PIN must be exactly 4 numbers.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const { data, error: insertError } = await supabase
      .from("employees")
      .insert({
        company_id: companyId,
        employee_number: createEmployeeNumber.trim() || null,
        first_name: createFirstName.trim(),
        last_name: createLastName.trim(),
        job_title: createJobTitle.trim() || null,
        default_store_id: createStoreId || null,
        employment_type: createEmploymentType || "permanent",
        phone: createPhone.trim() || null,
        email: createEmail.trim() || null,
        pin_code: createPinCode.trim() || null,
        kiosk_access_enabled: true,
        active: true,
      })
      .select("id")
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setCreateFirstName("");
    setCreateLastName("");
    setCreateEmployeeNumber("");
    setCreateJobTitle("");
    setCreateStoreId("");
    setCreatePhone("");
    setCreateEmail("");
    setCreateEmploymentType("permanent");
    setCreatePinCode("");
    setSelectedEmployeeId(data.id);
    setMessage("Employee created successfully.");
    setSaving(false);
    await loadData(companyId);
  }

  async function archiveOrRestoreEmployee(nextActive: boolean) {
    if (!selectedEmployee) return;
    if (!canManageEmployees) {
      setError("You do not have permission to update employee status.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: updateError } = await supabase
      .from("employees")
      .update({ active: nextActive })
      .eq("id", selectedEmployee.id)
      .eq("company_id", companyId);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await supabase.from("employee_status_history").insert({
      company_id: companyId,
      employee_id: selectedEmployee.id,
      previous_status: selectedEmployee.active === false ? "inactive" : "active",
      new_status: nextActive ? "restored" : "archived",
      effective_date: new Date().toISOString().slice(0, 10),
      reason: nextActive ? "Manual restore" : "Manual archive",
      instruction_text: nextActive
        ? "Employee restored and re-activated."
        : "Employee archived and de-activated.",
    });

    setMessage(nextActive ? "Employee restored." : "Employee archived.");
    setSaving(false);
    await loadData(companyId);
  }

  async function terminateEmployee() {
    if (!selectedEmployee) return;
    if (!canManageEmployees) {
      setError("You do not have permission to terminate employees.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    const effectiveDate = new Date().toISOString().slice(0, 10);

    const { error: employeeError } = await supabase
      .from("employees")
      .update({ active: false })
      .eq("id", selectedEmployee.id)
      .eq("company_id", companyId);

    if (employeeError) {
      setError(employeeError.message);
      setSaving(false);
      return;
    }

    await supabase.from("employee_movements").insert({
      company_id: companyId,
      employee_id: selectedEmployee.id,
      movement_type: "termination",
      from_store_id: selectedEmployee.default_store_id,
      to_store_id: null,
      effective_date: effectiveDate,
      instruction_text: `${employeeName(selectedEmployee)} terminated. Login disabled and future rosters removed.`,
      status: "applied",
      applied_at: new Date().toISOString(),
    });

    await supabase
      .from("roster_shifts")
      .update({ status: "cancelled" })
      .eq("company_id", companyId)
      .eq("employee_id", selectedEmployee.id)
      .gte("shift_date", effectiveDate);

    await supabase.from("employee_status_history").insert({
      company_id: companyId,
      employee_id: selectedEmployee.id,
      previous_status: selectedEmployee.active === false ? "inactive" : "active",
      new_status: "terminated",
      effective_date: effectiveDate,
      reason: "Manual termination",
      instruction_text: "Terminated from Employee Manager.",
    });

    setMessage("Employee terminated and future rosters cancelled.");
    setSaving(false);
    await loadData(companyId);
  }

  async function rehireEmployee() {
    if (!selectedEmployee) return;
    if (!canManageEmployees) {
      setError("You do not have permission to rehire employees.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    const effectiveDate = new Date().toISOString().slice(0, 10);

    const { error: employeeError } = await supabase
      .from("employees")
      .update({ active: true })
      .eq("id", selectedEmployee.id)
      .eq("company_id", companyId);

    if (employeeError) {
      setError(employeeError.message);
      setSaving(false);
      return;
    }

    await supabase.from("employee_status_history").insert({
      company_id: companyId,
      employee_id: selectedEmployee.id,
      previous_status: selectedEmployee.active === false ? "terminated" : "active",
      new_status: "rehired",
      effective_date: effectiveDate,
      reason: "Manual rehire",
      instruction_text: "Rehired from Employee Manager.",
    });

    setMessage("Employee rehired and activated.");
    setSaving(false);
    await loadData(companyId);
  }

  async function deleteEmployee() {
    if (!selectedEmployee) return;
    if (!isOwner) {
      setError("Only owners can permanently delete employees.");
      return;
    }

    const confirmed = window.confirm(
      `Delete ${employeeName(selectedEmployee)} permanently? This cannot be undone.`
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: deleteError } = await supabase
      .from("employees")
      .delete()
      .eq("id", selectedEmployee.id)
      .eq("company_id", companyId);

    if (deleteError) {
      setError(deleteError.message);
      setSaving(false);
      return;
    }

    setSelectedEmployeeId("");
    setMessage("Employee deleted.");
    setSaving(false);
    await loadData(companyId);
  }

  function storeName(id: string | null) {
    if (!id) return "No default store";
    return stores.find((store) => store.id === id)?.name || "Unknown store";
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] p-4 text-slate-950 md:p-8">
      <section className="mx-auto max-w-7xl">
        <header className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-6 text-white shadow-2xl shadow-slate-300 md:p-7">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.4em] text-cyan-300">VYRON CORE</div>
              <h1 className="mt-4 text-4xl font-black tracking-tight md:text-5xl">Employee Management</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Production workflows for lifecycle, profile updates, search, import/export and document control.
              </p>
            </div>

            <button
              onClick={() => companyId && loadData(companyId)}
              className="flex w-fit items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-slate-950 shadow-xl"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          <div className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">
            Role: {userRole || "employee"}
          </div>
        </header>

        <section className="mt-6 grid gap-5 md:grid-cols-3">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            <Users className="h-7 w-7 text-blue-600" />
            <div className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Total employees</div>
            <div className="mt-2 text-4xl font-black">{employees.length}</div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            <div className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Active</div>
            <div className="mt-2 text-4xl font-black">{activeCount}</div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.06)]">
            <AlertTriangle className="h-7 w-7 text-rose-600" />
            <div className="mt-4 text-xs font-black uppercase tracking-[0.2em] text-slate-400">Inactive</div>
            <div className="mt-2 text-4xl font-black">{inactiveCount}</div>
          </div>
        </section>

        <section className="mt-6 flex flex-wrap gap-2">
          {([
            ["profile", "Profile & Lifecycle"],
            ["search", "Search"],
            ["import", "Import / Export"],
            ["documents", "Documents"],
            ["movement", "Transfers / Termination"],
            ["enterprise", "Enterprise Enhancements"],
          ] as Array<[TabKey, string]>).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
                activeTab === tab
                  ? "bg-slate-950 text-white"
                  : "bg-white text-slate-600 border border-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </section>

        {error && <div className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm font-semibold text-rose-700">{error}</div>}
        {message && <div className="mt-5 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{message}</div>}

        {activeTab === "profile" && (
          <section className="mt-8 grid gap-8 xl:grid-cols-[0.85fr_1.15fr]">
            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">Employees</h2>
                  <p className="mt-2 text-sm text-slate-500">Click an employee to edit.</p>
                </div>
              </div>

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search employees..."
                className="mt-5 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
              />

              <div className="mt-5 space-y-3 max-h-[420px] overflow-auto pr-1">
                {loading ? (
                  <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">Loading employees...</div>
                ) : filteredEmployees.length === 0 ? (
                  <div className="rounded-2xl bg-slate-50 p-5 text-sm font-semibold text-slate-500">No employees found.</div>
                ) : (
                  filteredEmployees.map((employee) => {
                    const selected = employee.id === selectedEmployeeId;
                    return (
                      <button
                        key={employee.id}
                        onClick={() => setSelectedEmployeeId(employee.id)}
                        className={`w-full rounded-[24px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                          selected ? "border-blue-400 bg-blue-50 shadow-lg" : "border-slate-200 bg-slate-50"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-lg font-bold text-slate-950">{employeeName(employee)}</div>
                            <div className="mt-1 text-xs font-semibold text-slate-500">
                              {employee.employee_number || "No employee number"} · {employee.job_title || "No job title"}
                            </div>
                          </div>
                          <StatusPill active={employee.active !== false} />
                        </div>

                        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                          <div className="rounded-2xl bg-white p-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Store</div>
                            <div className="mt-1 font-bold">{storeName(employee.default_store_id)}</div>
                          </div>
                          <div className="rounded-2xl bg-white p-3">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Contact</div>
                            <div className="mt-1 font-bold">{employee.phone || employee.email || "Not loaded"}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            <div className="rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              {!selectedEmployee ? (
                <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
                  <UserRound className="h-14 w-14 text-slate-300" />
                  <h2 className="mt-4 text-2xl font-bold">Select an employee</h2>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Employee Profile</div>
                      <h2 className="mt-2 text-3xl font-bold text-slate-950">{employeeName(selectedEmployee)}</h2>
                    </div>
                    <ShieldCheck className="h-9 w-9 text-blue-600" />
                  </div>

                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <Field label="Employee number" value={employeeNumber} onChange={setEmployeeNumber} placeholder="EMP001" />
                    <Field label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Counter Assistant" />
                    <Field label="First name" value={firstName} onChange={setFirstName} placeholder="First name" />
                    <Field label="Last name" value={lastName} onChange={setLastName} placeholder="Last name" />
                    <Field label="Phone" value={phone} onChange={setPhone} placeholder="082..." />
                    <Field label="Email" value={email} onChange={setEmail} placeholder="name@email.com" type="email" />
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="text-sm font-bold text-slate-800">
                      Default store
                      <select
                        value={defaultStoreId}
                        onChange={(event) => setDefaultStoreId(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                      >
                        <option value="">No default store</option>
                        {stores.map((storeRow) => (
                          <option key={storeRow.id} value={storeRow.id}>{storeRow.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="text-sm font-bold text-slate-800">
                      Employment type
                      <select
                        value={employmentType}
                        onChange={(event) => setEmploymentType(event.target.value)}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                      >
                        <option value="permanent">Permanent</option>
                        <option value="temporary">Temporary</option>
                        <option value="part_time">Part-time</option>
                        <option value="casual">Casual</option>
                        <option value="contractor">Contractor</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-5 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Employee PIN / Kiosk Access</div>
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                      <input
                        value={pinCode}
                        onChange={(event) => setPinCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
                        placeholder="4-digit PIN"
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-950 outline-none focus:border-blue-500"
                      />
                      <button onClick={generatePin} className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white">Auto Generate PIN</button>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        onClick={() => setKioskEnabled((value) => !value)}
                        className={`rounded-2xl px-4 py-3 text-sm font-bold text-white ${
                          kioskEnabled ? "bg-emerald-600" : "bg-rose-600"
                        }`}
                      >
                        Kiosk Access: {kioskEnabled ? "Enabled" : "Disabled"}
                      </button>
                      <button
                        onClick={() => setActiveStatus((value) => !value)}
                        className={`rounded-2xl px-4 py-3 text-sm font-bold text-white ${
                          activeStatus ? "bg-emerald-600" : "bg-rose-600"
                        }`}
                      >
                        Employee Status: {activeStatus ? "Active" : "Inactive"}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={saveEmployee}
                    disabled={saving}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-bold text-white disabled:opacity-60"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Save Employee Changes"}
                  </button>

                  <div className="mt-5 grid gap-2 md:grid-cols-2">
                    <button
                      onClick={() => archiveOrRestoreEmployee(false)}
                      disabled={saving || !selectedEmployee.active}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      <Archive className="h-4 w-4" />
                      Archive Employee
                    </button>
                    <button
                      onClick={() => archiveOrRestoreEmployee(true)}
                      disabled={saving || selectedEmployee.active}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restore Employee
                    </button>
                    <button
                      onClick={terminateEmployee}
                      disabled={saving || !canManageEmployees}
                      className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      Terminate Employee
                    </button>
                    <button
                      onClick={rehireEmployee}
                      disabled={saving || !canManageEmployees}
                      className="rounded-2xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50"
                    >
                      Rehire Employee
                    </button>
                    <button
                      onClick={deleteEmployee}
                      disabled={saving || !isOwner}
                      className="md:col-span-2 flex items-center justify-center gap-2 rounded-2xl border border-rose-300 bg-white px-4 py-3 text-sm font-black text-rose-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Employee (Owner only)
                    </button>
                  </div>

                  <div className="mt-6 rounded-[26px] border border-slate-200 bg-slate-50 p-5">
                    <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">
                      Extended Employee Profile
                    </div>
                    <p className="mt-2 text-sm font-semibold text-slate-600">
                      Save all profile sections for personal, employment, compliance, payroll, clocking, training, and notes.
                    </p>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <Field label="Department" value={profileDepartment} onChange={setProfileDepartment} placeholder="Department" />
                      <Field label="Position" value={profilePosition} onChange={setProfilePosition} placeholder="Position" />
                      <Field label="Supervisor" value={profileSupervisor} onChange={setProfileSupervisor} placeholder="Supervisor" />
                      <Field label="Employment status" value={profileEmploymentStatus} onChange={setProfileEmploymentStatus} placeholder="Active, Suspended, Notice Period, Terminated..." />
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="text-sm font-bold text-slate-800">
                        Personal Information
                        <textarea
                          value={profilePersonalInformation}
                          onChange={(event) => setProfilePersonalInformation(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Employment Information
                        <textarea
                          value={profileEmploymentInformation}
                          onChange={(event) => setProfileEmploymentInformation(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Company Information
                        <textarea
                          value={profileCompanyInformation}
                          onChange={(event) => setProfileCompanyInformation(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Contact Details
                        <textarea
                          value={profileContactDetails}
                          onChange={(event) => setProfileContactDetails(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Emergency Contacts
                        <textarea
                          value={profileEmergencyContacts}
                          onChange={(event) => setProfileEmergencyContacts(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Next of Kin
                        <textarea
                          value={profileNextOfKin}
                          onChange={(event) => setProfileNextOfKin(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Identification
                        <textarea
                          value={profileIdentification}
                          onChange={(event) => setProfileIdentification(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Payroll Information
                        <textarea
                          value={profilePayrollInformation}
                          onChange={(event) => setProfilePayrollInformation(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Clocking Information
                        <textarea
                          value={profileClockingInformation}
                          onChange={(event) => setProfileClockingInformation(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                      <label className="text-sm font-bold text-slate-800">
                        Training
                        <textarea
                          value={profileTraining}
                          onChange={(event) => setProfileTraining(event.target.value)}
                          rows={4}
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                        />
                      </label>
                    </div>

                    <label className="mt-4 block text-sm font-bold text-slate-800">
                      Notes
                      <textarea
                        value={profileNotes}
                        onChange={(event) => setProfileNotes(event.target.value)}
                        rows={4}
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold outline-none focus:border-blue-500"
                      />
                    </label>

                    <div className="mt-4 grid gap-2 rounded-2xl bg-white p-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 md:grid-cols-5">
                      <div>Documents: {documentsCount}</div>
                      <div>Warnings: {warningsCount}</div>
                      <div>HR Cases: {hrCasesCount}</div>
                      <div>Leave History: {leaveCount}</div>
                      <div>Attendance: {attendanceCount}</div>
                    </div>

                    <button
                      onClick={saveEmployeeProfileSections}
                      disabled={saving || !canManageEmployees}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white disabled:opacity-50"
                    >
                      <Save className="h-4 w-4" />
                      Save Profile Sections
                    </button>
                  </div>
                </>
              )}
            </div>

            <div className="xl:col-span-2 rounded-[34px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(0,0,0,0.08)]">
              <div className="text-xs font-bold uppercase tracking-[0.35em] text-blue-600">Create Employee</div>
              <h3 className="mt-2 text-2xl font-bold text-slate-950">New Employee Record</h3>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <Field label="First name" value={createFirstName} onChange={setCreateFirstName} placeholder="First name" />
                <Field label="Last name" value={createLastName} onChange={setCreateLastName} placeholder="Last name" />
                <Field label="Employee number" value={createEmployeeNumber} onChange={setCreateEmployeeNumber} placeholder="EMP001" />
                <Field label="Job title" value={createJobTitle} onChange={setCreateJobTitle} placeholder="Counter Assistant" />
                <Field label="Phone" value={createPhone} onChange={setCreatePhone} placeholder="082..." />
                <Field label="Email" value={createEmail} onChange={setCreateEmail} placeholder="name@company.co.za" type="email" />
                <label className="text-sm font-bold text-slate-800">
                  Default store
                  <select
                    value={createStoreId}
                    onChange={(event) => setCreateStoreId(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                  >
                    <option value="">No default store</option>
                    {stores.map((storeRow) => (
                      <option key={storeRow.id} value={storeRow.id}>{storeRow.name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-bold text-slate-800">
                  Employment type
                  <select
                    value={createEmploymentType}
                    onChange={(event) => setCreateEmploymentType(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-950 outline-none focus:border-blue-500"
                  >
                    <option value="permanent">Permanent</option>
                    <option value="temporary">Temporary</option>
                    <option value="part_time">Part-time</option>
                    <option value="casual">Casual</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </label>
                <Field label="PIN (optional)" value={createPinCode} onChange={setCreatePinCode} placeholder="1234" />
              </div>

              <button
                onClick={createEmployee}
                disabled={saving || !canManageEmployees}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-4 text-sm font-black text-white disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" />
                {saving ? "Creating..." : "Create Employee"}
              </button>
            </div>
          </section>
        )}

        {activeTab === "search" && (
          <div className="mt-8">
            <AdvancedEmployeeGlobalSearch />
          </div>
        )}

        {activeTab === "import" && (
          <div className="mt-8">
            <EmployeeImportWizard />
          </div>
        )}

        {activeTab === "documents" && (
          <div className="mt-8">
            <EmployeeDocumentVaultPanel />
          </div>
        )}

        {activeTab === "movement" && (
          <div className="mt-8">
            <WorkforceMovementPanel companyId={companyId} />
          </div>
        )}

        {activeTab === "enterprise" && (
          <div className="mt-8">
            <EmployeeEnterpriseEnhancementsPanel />
          </div>
        )}
      </section>
    </main>
  );
}
