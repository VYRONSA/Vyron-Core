'use client';

import { useEffect, useMemo, useState } from 'react';
import { getCompanyAccess } from '@/lib/company-access';
import { buildHrWarningInsert } from '@/lib/hr-warning-schema';
import { supabase } from '@/lib/supabase';

type WarningType = 'verbal' | 'written' | 'final_written';
type IncidentType =
  | 'late_coming'
  | 'absenteeism'
  | 'misconduct'
  | 'poor_performance'
  | 'insubordination'
  | 'other';
type Severity = 'low' | 'medium' | 'high' | 'critical';
type WarningStatus = 'active' | 'expiring_soon' | 'expired' | 'withdrawn';

type HrWarning = {
  id: string;
  employee_id: string;
  employee_name: string;
  warning_type: WarningType;
  incident_type: IncidentType;
  incident_date: string;
  issue_date: string;
  expiry_date: string;
  severity: Severity;
  description: string;
  manager_notes: string | null;
  status: WarningStatus;
  created_at: string;
  updated_at: string;
};

const warningTypeOptions: { value: WarningType; label: string }[] = [
  { value: 'verbal', label: 'Verbal warning' },
  { value: 'written', label: 'Written warning' },
  { value: 'final_written', label: 'Final written warning' },
];

const incidentTypeOptions: { value: IncidentType; label: string }[] = [
  { value: 'late_coming', label: 'Late coming' },
  { value: 'absenteeism', label: 'Absenteeism' },
  { value: 'misconduct', label: 'Misconduct' },
  { value: 'poor_performance', label: 'Poor performance' },
  { value: 'insubordination', label: 'Insubordination' },
  { value: 'other', label: 'Other' },
];

const severityOptions: { value: Severity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const statusStyles: Record<WarningStatus, string> = {
  active: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300',
  expiring_soon: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
  expired: 'border-slate-500/35 bg-slate-500/10 text-slate-300',
  withdrawn: 'border-rose-500/35 bg-rose-500/10 text-rose-300',
};

const severityStyles: Record<Severity, string> = {
  low: 'border-sky-500/35 bg-sky-500/10 text-sky-300',
  medium: 'border-amber-500/35 bg-amber-500/10 text-amber-300',
  high: 'border-orange-500/35 bg-orange-500/10 text-orange-300',
  critical: 'border-rose-500/35 bg-rose-500/10 text-rose-300',
};

function todayValue() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return toDateInputValue(today);
}

function addMonthsToDateInput(dateValue: string, months: number) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return toDateInputValue(date);
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  if (!value) return '-';

  return new Intl.DateTimeFormat('en-ZA', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(new Date(`${value}T12:00:00`));
}

function daysUntil(value: string) {
  if (!value) return 0;

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const expiry = new Date(`${value}T12:00:00`);
  const difference = expiry.getTime() - today.getTime();

  return Math.ceil(difference / (1000 * 60 * 60 * 24));
}

function calculateStatus(expiryDate: string): WarningStatus {
  const days = daysUntil(expiryDate);

  if (days < 0) return 'expired';
  if (days <= 30) return 'expiring_soon';
  return 'active';
}

function displayWarningType(value: WarningType) {
  return warningTypeOptions.find((item) => item.value === value)?.label || value;
}

function displayIncidentType(value: IncidentType) {
  return incidentTypeOptions.find((item) => item.value === value)?.label || value;
}

function displayStatus(value: WarningStatus) {
  if (value === 'expiring_soon') return 'Expiring soon';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getGuidance(incidentType: IncidentType, warningType: WarningType) {
  if (incidentType === 'late_coming') {
    return {
      title: 'Late coming guidance',
      text:
        warningType === 'verbal'
          ? 'Suggested route: coach employee first, then verbal warning, then written warning if behaviour continues.'
          : warningType === 'written'
            ? 'Written warning is normally used when late-coming continues after coaching or a verbal warning.'
            : 'Final written warning is serious. Confirm previous action, evidence and company policy before issuing.',
    };
  }

  if (incidentType === 'absenteeism') {
    return {
      title: 'Absenteeism guidance',
      text:
        warningType === 'verbal'
          ? 'Absenteeism often needs documented facts. Confirm communication, sick notes and previous incidents first.'
          : warningType === 'written'
            ? 'Written warning may be appropriate for absence without proper communication or documentation.'
            : 'Repeated absenteeism may need a final warning or formal hearing process. Confirm procedure first.',
    };
  }

  return {
    title: 'HR guidance',
    text: 'Use fair procedure, record facts clearly, keep evidence, and confirm against company policy and South African labour law.',
  };
}

function buildPrintHtml(warning: HrWarning) {
  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>HR Warning - ${warning.employee_name}</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      color: #111827;
      margin: 40px;
      line-height: 1.5;
    }
    .header {
      border-bottom: 3px solid #0f172a;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .brand {
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 4px;
    }
    .tag {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 3px;
      color: #0369a1;
      margin-top: 4px;
    }
    h1 {
      font-size: 26px;
      margin-top: 28px;
      margin-bottom: 6px;
    }
    .subtitle {
      color: #475569;
      margin-bottom: 24px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 24px;
    }
    .box {
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 14px;
    }
    .label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #64748b;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .value {
      font-weight: 800;
      font-size: 14px;
    }
    .section {
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .signature-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 70px;
    }
    .line {
      border-top: 1px solid #111827;
      padding-top: 8px;
      font-size: 12px;
      font-weight: 700;
    }
    .note {
      margin-top: 24px;
      font-size: 11px;
      color: #64748b;
    }
    @media print {
      body { margin: 28px; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">VYRON</div>
    <div class="tag">CORE · HR WARNING NOTICE</div>
  </div>

  <h1>${displayWarningType(warning.warning_type)}</h1>
  <div class="subtitle">Formal HR warning record for employee file.</div>

  <div class="grid">
    <div class="box">
      <div class="label">Employee name</div>
      <div class="value">${warning.employee_name}</div>
    </div>
    <div class="box">
      <div class="label">Employee code</div>
      <div class="value">${warning.employee_id}</div>
    </div>
    <div class="box">
      <div class="label">Incident type</div>
      <div class="value">${displayIncidentType(warning.incident_type)}</div>
    </div>
    <div class="box">
      <div class="label">Severity</div>
      <div class="value">${warning.severity.toUpperCase()}</div>
    </div>
    <div class="box">
      <div class="label">Incident date</div>
      <div class="value">${formatDate(warning.incident_date)}</div>
    </div>
    <div class="box">
      <div class="label">Issue date</div>
      <div class="value">${formatDate(warning.issue_date)}</div>
    </div>
    <div class="box">
      <div class="label">Expiry date</div>
      <div class="value">${formatDate(warning.expiry_date)}</div>
    </div>
    <div class="box">
      <div class="label">Status</div>
      <div class="value">${displayStatus(warning.status)}</div>
    </div>
  </div>

  <div class="section">
    <div class="label">Incident details</div>
    <div>${warning.description}</div>
  </div>

  <div class="section">
    <div class="label">Manager notes</div>
    <div>${warning.manager_notes || 'None recorded.'}</div>
  </div>

  <div class="signature-grid">
    <div class="line">Employee signature / date</div>
    <div class="line">Manager signature / date</div>
  </div>

  <p class="note">
    Guidance only — confirm with company policy and South African labour law. This document should be stored in the employee HR file.
  </p>

  <script>
    window.print();
  </script>
</body>
</html>
`;
}

export default function HrWarningsPage() {
  const [companyId, setCompanyId] = useState('');
  const [warnings, setWarnings] = useState<HrWarning[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [warningType, setWarningType] = useState<WarningType>('verbal');
  const [incidentType, setIncidentType] = useState<IncidentType>('late_coming');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [incidentDate, setIncidentDate] = useState(todayValue());
  const [issueDate, setIssueDate] = useState(todayValue());
  const [expiryDate, setExpiryDate] = useState(addMonthsToDateInput(todayValue(), 6));
  const [description, setDescription] = useState('');
  const [managerNotes, setManagerNotes] = useState('');

  const guidance = getGuidance(incidentType, warningType);

  const activeCount = useMemo(
    () => warnings.filter((item) => item.status === 'active').length,
    [warnings]
  );

  const expiringCount = useMemo(
    () => warnings.filter((item) => item.status === 'expiring_soon').length,
    [warnings]
  );

  const expiredCount = useMemo(
    () => warnings.filter((item) => item.status === 'expired').length,
    [warnings]
  );

  const criticalCount = useMemo(
    () => warnings.filter((item) => item.severity === 'critical').length,
    [warnings]
  );

  useEffect(() => {
    let cancelled = false;

    async function resolveCompany() {
      const { access, error } = await getCompanyAccess(supabase);
      if (cancelled) return;
      if (error || !access?.company_id) {
        alert(error || 'No company access.');
        setLoading(false);
        return;
      }
      setCompanyId(access.company_id);
    }

    void resolveCompany();
    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchWarnings(activeCompanyId = companyId) {
    if (!activeCompanyId) return;
    setLoading(true);

    const { data, error } = await supabase
      .from('hr_warnings')
      .select('*')
      .eq('company_id', activeCompanyId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error(error);
      alert(error.message);
      setLoading(false);
      return;
    }

    const checkedWarnings = ((data || []) as HrWarning[]).map((warning) => ({
      ...warning,
      status:
        warning.status === 'withdrawn'
          ? 'withdrawn'
          : calculateStatus(warning.expiry_date),
    }));

    setWarnings(checkedWarnings);
    setLoading(false);
  }

  useEffect(() => {
    if (companyId) void fetchWarnings(companyId);
  }, [companyId]);

  function useSixMonths() {
    setExpiryDate(addMonthsToDateInput(issueDate, 6));
  }

  function useTwelveMonths() {
    setExpiryDate(addMonthsToDateInput(issueDate, 12));
  }

  function printWarning(warning: HrWarning) {
    const printWindow = window.open('', '_blank', 'width=900,height=1100');

    if (!printWindow) {
      alert('Popup blocked. Please allow popups and try again.');
      return;
    }

    printWindow.document.open();
    printWindow.document.write(buildPrintHtml(warning));
    printWindow.document.close();
  }

  function openWhatsAppDraft(warning: HrWarning) {
    const message = [
      `VYRON CORE HR WARNING`,
      ``,
      `Employee: ${warning.employee_name}`,
      `Employee Code: ${warning.employee_id}`,
      `Warning: ${displayWarningType(warning.warning_type)}`,
      `Incident: ${displayIncidentType(warning.incident_type)}`,
      `Issue Date: ${formatDate(warning.issue_date)}`,
      `Expiry Date: ${formatDate(warning.expiry_date)}`,
      ``,
      `Please contact your manager to receive and sign the warning document.`,
    ].join('\n');

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  }

  async function createWarning() {
    if (!employeeId.trim()) {
      alert('Please enter the employee code.');
      return;
    }

    if (!employeeName.trim()) {
      alert('Please enter the employee name.');
      return;
    }

    if (!incidentDate || !issueDate || !expiryDate) {
      alert('Please complete all dates.');
      return;
    }

    if (new Date(`${expiryDate}T12:00:00`) < new Date(`${issueDate}T12:00:00`)) {
      alert('Expiry date cannot be before issue date.');
      return;
    }

    if (!description.trim()) {
      alert('Please describe what happened.');
      return;
    }

    setSaving(true);

    if (!companyId) {
      alert('Company not loaded yet.');
      setSaving(false);
      return;
    }

    const employeeCode = employeeId.trim().toUpperCase();
    const { data: matchedEmployee } = await supabase
      .from('employees')
      .select('id,first_name,last_name,employee_number')
      .eq('company_id', companyId)
      .or(`employee_number.eq.${employeeCode},id.eq.${employeeCode}`)
      .maybeSingle();

    const resolvedEmployeeId = matchedEmployee?.id || employeeCode;
    const resolvedEmployeeName =
      employeeName.trim() ||
      [matchedEmployee?.first_name, matchedEmployee?.last_name].filter(Boolean).join(' ') ||
      employeeCode;

    const richDescription = [
      `[${resolvedEmployeeName}]`,
      `Incident: ${incidentType.replaceAll('_', ' ')}`,
      `Incident date: ${incidentDate}`,
      `Issue date: ${issueDate}`,
      `Expiry date: ${expiryDate}`,
      description.trim(),
      managerNotes.trim() ? `Manager notes: ${managerNotes.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    const warningInsert = buildHrWarningInsert({
      companyId,
      employeeId: resolvedEmployeeId,
      warningType,
      description: description.trim(),
      status: calculateStatus(expiryDate),
      expiryDate,
      employeeName: resolvedEmployeeName,
      incidentType,
      incidentDate,
      issueDate,
      severity,
      managerNotes: managerNotes.trim() || null,
    });

    const { error } = await supabase.from('hr_warnings').insert(warningInsert);

    if (error) {
      console.error(error);
      alert(error.message);
      setSaving(false);
      return;
    }

    setEmployeeId('');
    setEmployeeName('');
    setWarningType('verbal');
    setIncidentType('late_coming');
    setSeverity('medium');
    setIncidentDate(todayValue());
    setIssueDate(todayValue());
    setExpiryDate(addMonthsToDateInput(todayValue(), 6));
    setDescription('');
    setManagerNotes('');
    setSaving(false);

    await fetchWarnings();
  }

  async function withdrawWarning(id: string) {
    const reason = window.prompt('Reason for withdrawing this warning:');

    if (reason === null) return;

    if (!companyId) return;

    const { error } = await supabase
      .from('hr_warnings')
      .update({
        status: 'withdrawn',
        description: `Withdrawn: ${reason.trim() || 'Withdrawn by manager.'}`,
      })
      .eq('id', id)
      .eq('company_id', companyId);

    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }

    await fetchWarnings();
  }

  return (
    <main className="min-h-screen bg-[#080f1d] text-white">
      <div className="flex min-h-screen">
        <aside className="hidden w-[260px] shrink-0 border-r border-white/10 bg-[#07111f] px-5 py-6 lg:block">
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-400 font-black shadow-lg shadow-cyan-950/30">
              V
            </div>
            <div>
              <p className="text-lg font-black tracking-[0.18em]">VYRON</p>
              <p className="text-[10px] font-bold tracking-[0.36em] text-cyan-300">
                CORE
              </p>
            </div>
          </div>

          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">
            Overview
          </p>

          <nav className="space-y-2 text-sm font-bold">
            {['Command Centre', 'Super Dashboard'].map((item) => (
              <div
                key={item}
                className="rounded-xl px-4 py-3 text-slate-300 hover:bg-white/5"
              >
                {item}
              </div>
            ))}
          </nav>

          <p className="mb-3 mt-8 text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">
            Operations
          </p>

          <nav className="space-y-2 text-sm font-bold">
            {[
              'Stores',
              'Employees',
              'Roster Builder',
              'Clocking Live',
              'Staff Clocking',
              'Exceptions',
            ].map((item) => (
              <div
                key={item}
                className="rounded-xl px-4 py-3 text-slate-300 hover:bg-white/5"
              >
                {item}
              </div>
            ))}
          </nav>

          <p className="mb-3 mt-8 text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">
            HR & Compliance
          </p>

          <nav className="space-y-2 text-sm font-bold">
            {['HR Cases', 'HR Warnings', 'Leave Approvals', 'Compliance'].map(
              (item) => (
                <div
                  key={item}
                  className={`rounded-xl px-4 py-3 ${
                    item === 'HR Warnings'
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-950/30'
                      : 'text-slate-300 hover:bg-white/5'
                  }`}
                >
                  {item}
                </div>
              )
            )}
          </nav>

          <p className="mb-3 mt-8 text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">
            Payroll
          </p>

          <nav className="space-y-2 text-sm font-bold">
            <div className="rounded-xl px-4 py-3 text-slate-300 hover:bg-white/5">
              Payroll Prep
            </div>
          </nav>
        </aside>

        <section className="flex-1 px-5 py-6 md:px-8">
          <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <button className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-slate-300">
                  ☰
                </button>
                <div>
                  <h1 className="text-3xl font-black tracking-tight">
                    HR Warnings
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Manager-only warning register, print workflow and employee file record.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 px-4 py-3 text-sm font-black text-cyan-300">
              Manager Function
            </div>
          </header>

          <section className="mb-5 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-emerald-500/25 bg-[#111827] p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Active
              </p>
              <p className="mt-3 text-4xl font-black">{activeCount}</p>
            </div>

            <div className="rounded-2xl border border-amber-500/25 bg-[#111827] p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Expiring soon
              </p>
              <p className="mt-3 text-4xl font-black text-amber-300">
                {expiringCount}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-500/25 bg-[#111827] p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Expired
              </p>
              <p className="mt-3 text-4xl font-black text-slate-300">
                {expiredCount}
              </p>
            </div>

            <div className="rounded-2xl border border-rose-500/25 bg-[#111827] p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">
                Critical
              </p>
              <p className="mt-3 text-4xl font-black text-rose-300">
                {criticalCount}
              </p>
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-[430px_1fr]">
            <div className="rounded-[28px] border border-white/10 bg-[#111827] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.3em] text-cyan-300">
                Manager action
              </p>

              <h2 className="text-3xl font-black leading-tight tracking-tight">
                Create warning.
              </h2>

              <p className="mt-3 text-sm leading-6 text-slate-400">
                Only managers should access this page. Employee kiosk screens must not show this.
              </p>

              <div className="mt-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                      Employee code
                    </span>
                    <input
                      value={employeeId}
                      onChange={(event) =>
                        setEmployeeId(event.target.value.toUpperCase())
                      }
                      placeholder="EMP001"
                      className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-base font-black text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                      Employee name
                    </span>
                    <input
                      value={employeeName}
                      onChange={(event) => setEmployeeName(event.target.value)}
                      placeholder="Employee name"
                      className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-base font-bold text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                      Warning type
                    </span>
                    <select
                      value={warningType}
                      onChange={(event) =>
                        setWarningType(event.target.value as WarningType)
                      }
                      className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-base font-black text-white outline-none focus:border-cyan-400"
                    >
                      {warningTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                      Incident type
                    </span>
                    <select
                      value={incidentType}
                      onChange={(event) =>
                        setIncidentType(event.target.value as IncidentType)
                      }
                      className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-base font-black text-white outline-none focus:border-cyan-400"
                    >
                      {incidentTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    Severity
                  </span>
                  <select
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as Severity)}
                    className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-base font-black text-white outline-none focus:border-cyan-400"
                  >
                    {severityOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                      Incident date
                    </span>
                    <input
                      type="date"
                      value={incidentDate}
                      onChange={(event) => setIncidentDate(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                      Issue date
                    </span>
                    <input
                      type="date"
                      value={issueDate}
                      onChange={(event) => {
                        setIssueDate(event.target.value);
                        setExpiryDate(addMonthsToDateInput(event.target.value, 6));
                      }}
                      className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                      Expiry date
                    </span>
                    <input
                      type="date"
                      value={expiryDate}
                      onChange={(event) => setExpiryDate(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-sm font-black text-white outline-none focus:border-cyan-400"
                    />
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={useSixMonths}
                    className="rounded-2xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm font-black text-slate-300 hover:bg-[#263244]"
                  >
                    Set 6 months
                  </button>
                  <button
                    type="button"
                    onClick={useTwelveMonths}
                    className="rounded-2xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm font-black text-slate-300 hover:bg-[#263244]"
                  >
                    Set 12 months
                  </button>
                </div>

                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-950/25 p-4">
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-300">
                    {guidance.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-cyan-50">
                    {guidance.text}
                  </p>
                  <p className="mt-3 text-xs font-bold leading-5 text-slate-400">
                    Guidance only — confirm with company policy and South African labour law.
                  </p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    What happened?
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Record the facts clearly..."
                    rows={4}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-base font-bold text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    Manager notes
                  </span>
                  <textarea
                    value={managerNotes}
                    onChange={(event) => setManagerNotes(event.target.value)}
                    placeholder="Optional internal notes..."
                    rows={3}
                    className="w-full resize-none rounded-2xl border border-white/10 bg-[#1f2937] px-4 py-4 text-base font-bold text-white outline-none placeholder:text-slate-500 focus:border-cyan-400"
                  />
                </label>

                <button
                  onClick={createWarning}
                  disabled={saving}
                  className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-400 px-5 py-5 text-base font-black text-white shadow-lg shadow-cyan-950/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving Warning...' : 'Save HR Warning'}
                </button>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-[#111827] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
              <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-300">
                    HR Register
                  </p>
                  <h2 className="mt-2 text-2xl font-black">
                    Warnings and print records
                  </h2>
                  <p className="mt-2 text-sm text-slate-400">
                    Print warnings now. WhatsApp PDF sending will be added as a proper document workflow next.
                  </p>
                </div>

                <button
                  onClick={() => {
                    void fetchWarnings();
                  }}
                  className="rounded-2xl border border-white/10 bg-[#1f2937] px-5 py-3 text-sm font-black text-white hover:bg-[#263244]"
                >
                  Refresh
                </button>
              </div>

              {loading ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#0b1220] p-8 text-center text-sm font-bold text-slate-400">
                  Loading warnings...
                </div>
              ) : warnings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-[#0b1220] p-8 text-center">
                  <p className="text-lg font-black">No warnings yet</p>
                  <p className="mt-2 text-sm text-slate-400">
                    New warnings will appear here.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {warnings.map((warning) => {
                    const currentStatus =
                      warning.status === 'withdrawn'
                        ? 'withdrawn'
                        : calculateStatus(warning.expiry_date);
                    const daysLeft = daysUntil(warning.expiry_date);

                    return (
                      <article
                        key={warning.id}
                        className="rounded-2xl border border-white/10 bg-[#0b1220] p-5"
                      >
                        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <h3 className="text-xl font-black">
                              {warning.employee_name}
                            </h3>
                            <p className="mt-1 text-sm font-semibold text-slate-400">
                              Staff code: {warning.employee_id}
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${statusStyles[currentStatus]}`}
                            >
                              {displayStatus(currentStatus)}
                            </span>
                            <span
                              className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${severityStyles[warning.severity]}`}
                            >
                              {warning.severity}
                            </span>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                              Warning type
                            </p>
                            <p className="mt-2 text-sm font-black">
                              {displayWarningType(warning.warning_type)}
                            </p>
                          </div>

                          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                              Incident
                            </p>
                            <p className="mt-2 text-sm font-black">
                              {displayIncidentType(warning.incident_type)}
                            </p>
                          </div>

                          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                              Issued
                            </p>
                            <p className="mt-2 text-sm font-black">
                              {formatDate(warning.issue_date)}
                            </p>
                          </div>

                          <div className="rounded-xl border border-white/5 bg-[#111827] p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                              Expires
                            </p>
                            <p className="mt-2 text-sm font-black">
                              {formatDate(warning.expiry_date)}
                            </p>
                            <p className="mt-1 text-xs font-bold text-slate-400">
                              {daysLeft < 0
                                ? `${Math.abs(daysLeft)} days expired`
                                : `${daysLeft} days left`}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-white/5 bg-[#111827] p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                            Description
                          </p>
                          <p className="mt-2 text-sm leading-6 text-slate-300">
                            {warning.description}
                          </p>
                        </div>

                        {warning.manager_notes && (
                          <div className="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-950/25 p-4">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-300">
                              Manager notes
                            </p>
                            <p className="mt-2 text-sm leading-6 text-cyan-50">
                              {warning.manager_notes}
                            </p>
                          </div>
                        )}

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            onClick={() => printWarning(warning)}
                            className="rounded-xl border border-cyan-500/35 bg-cyan-500/10 px-4 py-3 text-sm font-black text-cyan-300 transition hover:bg-cyan-500/20"
                          >
                            Print Warning
                          </button>

                          <button
                            onClick={() => openWhatsAppDraft(warning)}
                            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 text-sm font-black text-emerald-300 transition hover:bg-emerald-500/20"
                          >
                            WhatsApp Notice
                          </button>

                          {currentStatus !== 'withdrawn' && (
                            <button
                              onClick={() => withdrawWarning(warning.id)}
                              className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 py-3 text-sm font-black text-rose-300 transition hover:bg-rose-500/20"
                            >
                              Withdraw Warning
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
