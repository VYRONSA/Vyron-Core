/**
 * VYRON CORE Phase 5A — Workforce AI Copilot query engine & skills.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchFieldOperationsSnapshot } from "@/lib/field-operations";
import { buildWorkforceCostDashboard } from "@/lib/field-cost-intelligence";
import { buildWorkforceJourneyDashboard } from "@/lib/field-travel-intelligence";
import { loadWorkforceRiskDashboard, scoreToRiskBand } from "@/lib/workforce-risk-intelligence";

export const COPILOT_SUGGESTED_PROMPTS = [
  "Who is late today?",
  "Who is absent?",
  "Who is travelling?",
  "Who is on site?",
  "Who is on leave?",
  "Which jobs are active?",
  "Which employees have high risk?",
  "Show payroll leakage risks.",
  "Generate attendance report.",
  "Generate overtime report.",
  "Generate workforce risk report.",
  "Generate field operations report.",
  "Generate labour cost report.",
] as const;

export const COPILOT_ACTION_PROMPTS = [
  "Create warning for [employee]",
  "Create HR case for [employee]",
  "Approve leave for [employee]",
  "Reject leave for [employee]",
  "Assign employee to job [job ref]",
  "Move employee to store [store]",
] as const;

export type CopilotIntent =
  | "who_late"
  | "who_absent"
  | "who_travelling"
  | "who_on_site"
  | "who_on_leave"
  | "active_jobs"
  | "high_risk_employees"
  | "payroll_leakage"
  | "report_attendance"
  | "report_overtime"
  | "report_workforce_risk"
  | "report_field_ops"
  | "report_labour_cost"
  | "action_create_warning"
  | "action_create_hr_case"
  | "action_approve_leave"
  | "action_reject_leave"
  | "action_assign_employee"
  | "action_move_employee"
  | "unknown";

export type CopilotSkillId =
  | "attendance_query"
  | "absence_query"
  | "travel_query"
  | "site_presence_query"
  | "leave_query"
  | "field_jobs_query"
  | "risk_query"
  | "leakage_query"
  | "attendance_report"
  | "overtime_report"
  | "risk_report"
  | "field_ops_report"
  | "labour_cost_report"
  | "hr_warning_action"
  | "hr_case_action"
  | "leave_approve_action"
  | "leave_reject_action"
  | "job_assign_action"
  | "employee_move_action";

export const COPILOT_SKILLS: { id: CopilotSkillId; label: string; module: string }[] = [
  { id: "attendance_query", label: "Late arrival lookup", module: "Clocking" },
  { id: "absence_query", label: "Absence detection", module: "Clocking" },
  { id: "travel_query", label: "Field travel status", module: "Travel Intelligence" },
  { id: "site_presence_query", label: "On-site presence", module: "Field Operations" },
  { id: "leave_query", label: "Leave roster lookup", module: "Leave" },
  { id: "field_jobs_query", label: "Active job board", module: "Field Operations" },
  { id: "risk_query", label: "High-risk employees", module: "Risk Intelligence" },
  { id: "leakage_query", label: "Payroll leakage scan", module: "Cost Intelligence" },
  { id: "attendance_report", label: "Attendance report", module: "Employees" },
  { id: "overtime_report", label: "Overtime report", module: "Payroll Readiness" },
  { id: "risk_report", label: "Workforce risk report", module: "Risk Intelligence" },
  { id: "field_ops_report", label: "Field operations report", module: "Field Operations" },
  { id: "labour_cost_report", label: "Labour cost report", module: "Cost Intelligence" },
  { id: "hr_warning_action", label: "Create warning", module: "HR" },
  { id: "hr_case_action", label: "Create HR case", module: "HR" },
  { id: "leave_approve_action", label: "Approve leave", module: "Leave" },
  { id: "leave_reject_action", label: "Reject leave", module: "Leave" },
  { id: "job_assign_action", label: "Assign employee", module: "Field Operations" },
  { id: "employee_move_action", label: "Move employee", module: "Employees" },
];

export type CopilotResponseRow = {
  label: string;
  value: string;
  meta?: string;
};

export type CopilotActionProposal = {
  actionType:
    | "create_warning"
    | "create_hr_case"
    | "approve_leave"
    | "reject_leave"
    | "assign_employee"
    | "move_employee";
  title: string;
  description: string;
  payload: Record<string, unknown>;
};

export type CopilotResponseCard = {
  id: string;
  type: "query" | "report" | "action" | "info";
  skillId?: CopilotSkillId;
  title: string;
  summary: string;
  band?: "green" | "amber" | "red";
  rows?: CopilotResponseRow[];
  reportText?: string;
  action?: CopilotActionProposal;
};

export type CopilotQueryResult = {
  id: string;
  intent: CopilotIntent;
  command: string;
  cards: CopilotResponseCard[];
  skillsUsed: CopilotSkillId[];
};

export type CopilotEmployee = {
  id: string;
  first_name: string;
  last_name: string;
  default_store_id: string | null;
};

export type CopilotStore = {
  id: string;
  name: string;
};

export type CopilotContext = {
  companyId: string;
  scoreDate: string;
  employees: CopilotEmployee[];
  stores: CopilotStore[];
  payrollClockChecks: {
    employee_id: string;
    shift_date: string;
    late_minutes: number;
    missing_clock_in: boolean;
    missing_clock_out: boolean;
    overtime_minutes: number;
  }[];
  leaveRequests: {
    id: string;
    employee_id: string;
    employee_name?: string | null;
    status: string;
    leave_type?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  }[];
  fieldSnapshot: Awaited<ReturnType<typeof fetchFieldOperationsSnapshot>> | null;
  journeyDashboard: ReturnType<typeof buildWorkforceJourneyDashboard> | null;
  costDashboard: ReturnType<typeof buildWorkforceCostDashboard> | null;
  riskDashboard: Awaited<ReturnType<typeof loadWorkforceRiskDashboard>>["dashboard"];
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function empLabel(emp: CopilotEmployee): string {
  return `${emp.first_name} ${emp.last_name}`.trim() || emp.id;
}

function findEmployeeByToken(employees: CopilotEmployee[], token: string): CopilotEmployee | null {
  const q = token.toLowerCase().trim();
  if (!q) return null;
  return (
    employees.find((e) => e.id.toLowerCase() === q) ||
    employees.find((e) => empLabel(e).toLowerCase().includes(q)) ||
    null
  );
}

function extractNameFromCommand(command: string): string | null {
  const patterns = [
    /(?:for|to)\s+([a-z][a-z\s'-]{2,40})/i,
    /employee\s+([a-z][a-z\s'-]{2,40})/i,
  ];
  for (const p of patterns) {
    const m = command.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

export function parseCopilotIntent(command: string): CopilotIntent {
  const q = command.toLowerCase().trim();
  if (!q) return "unknown";

  if (/create warning|issue warning|new warning/.test(q)) return "action_create_warning";
  if (/create hr case|open hr case|new hr case|create case/.test(q)) return "action_create_hr_case";
  if (/approve leave/.test(q)) return "action_approve_leave";
  if (/reject leave|decline leave/.test(q)) return "action_reject_leave";
  if (/assign employee|assign .+ to job/.test(q)) return "action_assign_employee";
  if (/move employee|transfer employee|move .+ to store/.test(q)) return "action_move_employee";

  if (/attendance report|generate attendance/.test(q)) return "report_attendance";
  if (/overtime report|generate overtime/.test(q)) return "report_overtime";
  if (/workforce risk report|risk report/.test(q)) return "report_workforce_risk";
  if (/field operations report|field ops report/.test(q)) return "report_field_ops";
  if (/labour cost report|labor cost report|labour cost|generate labour/.test(q)) {
    return "report_labour_cost";
  }

  if (/who is late|late today|late arrivals|who's late/.test(q)) return "who_late";
  if (/who is absent|absent today|who's absent|missing clock-in/.test(q)) return "who_absent";
  if (/who is travelling|who is traveling|on travel|who's travelling/.test(q)) {
    return "who_travelling";
  }
  if (/who is on site|on site today|who's on site/.test(q)) return "who_on_site";
  if (/who is on leave|on leave today|who's on leave/.test(q)) return "who_on_leave";
  if (/active jobs|which jobs|jobs are active/.test(q)) return "active_jobs";
  if (/high risk|which employees have high risk/.test(q)) return "high_risk_employees";
  if (/payroll leakage|leakage risk|show leakage/.test(q)) return "payroll_leakage";

  return "unknown";
}

export async function fetchCopilotContext(
  supabase: SupabaseClient,
  companyId: string,
  scoreDate = todayIsoDate()
): Promise<CopilotContext> {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartIso = weekStart.toISOString().slice(0, 10);

  const [employeesRes, storesRes, checksRes, leaveRes, fieldSnapshot, riskLoad] =
    await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name, default_store_id")
        .eq("company_id", companyId)
        .eq("active", true),
      supabase.from("stores").select("id, name").eq("company_id", companyId),
      supabase
        .from("payroll_clock_checks")
        .select(
          "employee_id, shift_date, late_minutes, missing_clock_in, missing_clock_out, overtime_minutes"
        )
        .eq("company_id", companyId)
        .gte("shift_date", weekStartIso),
      supabase
        .from("leave_requests")
        .select("id, employee_id, employee_name, status, leave_type, start_date, end_date")
        .order("created_at", { ascending: false })
        .limit(300),
      fetchFieldOperationsSnapshot(supabase, companyId),
      loadWorkforceRiskDashboard(supabase, companyId, scoreDate),
    ]);

  const journeyDashboard = fieldSnapshot.tablesAvailable
    ? buildWorkforceJourneyDashboard(fieldSnapshot, scoreDate, companyId)
    : null;
  const costDashboard = fieldSnapshot.tablesAvailable
    ? buildWorkforceCostDashboard({
        snapshot: fieldSnapshot,
        costDate: scoreDate,
        companyId,
      })
    : null;

  return {
    companyId,
    scoreDate,
    employees: (employeesRes.data || []) as CopilotEmployee[],
    stores: (storesRes.data || []) as CopilotStore[],
    payrollClockChecks: (checksRes.data || []) as CopilotContext["payrollClockChecks"],
    leaveRequests: (leaveRes.data || []) as CopilotContext["leaveRequests"],
    fieldSnapshot,
    journeyDashboard,
    costDashboard,
    riskDashboard: riskLoad.dashboard,
  };
}

function card(
  partial: Omit<CopilotResponseCard, "id"> & { id?: string }
): CopilotResponseCard {
  return { id: partial.id || `card-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...partial };
}

export function runCopilotQuery(context: CopilotContext, command: string): CopilotQueryResult {
  const intent = parseCopilotIntent(command);
  const cards: CopilotResponseCard[] = [];
  const skillsUsed: CopilotSkillId[] = [];
  const today = context.scoreDate;

  const employeeMap = new Map(context.employees.map((e) => [e.id, e]));
  const labelFor = (id: string) => {
    const e = employeeMap.get(id);
    return e ? empLabel(e) : id;
  };

  if (intent === "who_late") {
    skillsUsed.push("attendance_query");
    const rows = context.payrollClockChecks
      .filter((c) => c.shift_date === today && Number(c.late_minutes || 0) > 0)
      .map((c) => ({
        label: labelFor(c.employee_id),
        value: `${c.late_minutes} min late`,
        meta: "Payroll clock check",
      }));
    cards.push(
      card({
        type: "query",
        skillId: "attendance_query",
        title: "Late arrivals today",
        summary: rows.length
          ? `${rows.length} employee(s) flagged late on ${today}.`
          : `No late arrivals recorded for ${today}.`,
        band: rows.length >= 3 ? "red" : rows.length ? "amber" : "green",
        rows,
      })
    );
  }

  if (intent === "who_absent") {
    skillsUsed.push("absence_query");
    const rows = context.payrollClockChecks
      .filter((c) => c.shift_date === today && c.missing_clock_in)
      .map((c) => ({
        label: labelFor(c.employee_id),
        value: "Missing clock-in",
        meta: c.missing_clock_out ? "Also missing clock-out" : undefined,
      }));
    cards.push(
      card({
        type: "query",
        skillId: "absence_query",
        title: "Absent / missing clock-in",
        summary: rows.length
          ? `${rows.length} employee(s) missing clock-in today.`
          : "No missing clock-in flags for today.",
        band: rows.length ? "amber" : "green",
        rows,
      })
    );
  }

  if (intent === "who_travelling") {
    skillsUsed.push("travel_query");
    const travellingJobs =
      context.fieldSnapshot?.jobs.filter((j) => j.status === "Travelling") || [];
    const journeyRows =
      context.journeyDashboard?.journeys
        .filter((j) => j.route.travelSeconds > j.route.workingSeconds && j.route.status === "active")
        .map((j) => ({
          label: labelFor(j.employeeId),
          value: `${Math.round(j.route.travelSeconds / 60)} min travel`,
          meta: `${j.route.jobsCompleted} job(s) completed`,
        })) || [];
    const rows = [
      ...travellingJobs.map((j) => ({
        label: j.jobRef,
        value: j.title,
        meta: `Status: ${j.status}`,
      })),
      ...journeyRows,
    ];
    cards.push(
      card({
        type: "query",
        skillId: "travel_query",
        title: "Employees travelling",
        summary: rows.length
          ? `${rows.length} active travel signal(s) from field ops and journey data.`
          : "No active travel signals detected.",
        band: rows.length ? "amber" : "green",
        rows,
      })
    );
  }

  if (intent === "who_on_site") {
    skillsUsed.push("site_presence_query");
    const onSiteJobs =
      context.fieldSnapshot?.jobs.filter((j) => j.status === "On Site") || [];
    const siteRows =
      context.journeyDashboard?.journeys
        .filter((j) => j.route.siteSeconds > 0 || j.route.workingSeconds > 0)
        .map((j) => ({
          label: labelFor(j.employeeId),
          value: `${Math.round(j.route.workingSeconds / 60)} min working`,
          meta: `${Math.round(j.route.siteSeconds / 60)} min on site`,
        })) || [];
    const rows = [
      ...onSiteJobs.map((j) => ({
        label: j.jobRef,
        value: j.title,
        meta: "Job on site",
      })),
      ...siteRows,
    ];
    cards.push(
      card({
        type: "query",
        skillId: "site_presence_query",
        title: "On-site presence",
        summary: rows.length
          ? `${rows.length} on-site signal(s) from jobs and journeys.`
          : "No on-site presence detected for today.",
        band: "green",
        rows: rows.slice(0, 20),
      })
    );
  }

  if (intent === "who_on_leave") {
    skillsUsed.push("leave_query");
    const rows = context.leaveRequests
      .filter((l) => {
        const status = (l.status || "").toLowerCase();
        if (!["approved", "pending", "submitted"].includes(status)) return false;
        const start = l.start_date || "";
        const end = l.end_date || start;
        return start <= today && end >= today;
      })
      .map((l) => ({
        label: l.employee_name || labelFor(l.employee_id),
        value: (l.leave_type || "leave").replace(/_/g, " "),
        meta: `${l.start_date} → ${l.end_date} (${l.status})`,
      }));
    cards.push(
      card({
        type: "query",
        skillId: "leave_query",
        title: "On leave today",
        summary: rows.length
          ? `${rows.length} leave record(s) covering ${today}.`
          : "No leave records cover today.",
        band: rows.length ? "amber" : "green",
        rows,
      })
    );
  }

  if (intent === "active_jobs") {
    skillsUsed.push("field_jobs_query");
    const active =
      context.fieldSnapshot?.jobs.filter((j) =>
        ["Dispatched", "Travelling", "On Site", "Pending"].includes(j.status)
      ) || [];
    const rows = active.map((j) => ({
      label: j.jobRef,
      value: j.title,
      meta: `${j.status} · ${j.customerName || "No customer"}`,
    }));
    cards.push(
      card({
        type: "query",
        skillId: "field_jobs_query",
        title: "Active field jobs",
        summary: `${rows.length} job(s) in active pipeline.`,
        band: rows.length > 10 ? "amber" : "green",
        rows,
      })
    );
  }

  if (intent === "high_risk_employees") {
    skillsUsed.push("risk_query");
    const high =
      context.riskDashboard?.employeeScores.filter((e) => e.overallScore >= 70) || [];
    const rows = high.map((e) => ({
      label: e.entityLabel,
      value: `${e.overallScore}/100`,
      meta: e.factors.slice(0, 2).join(" · ") || e.riskBand,
    }));
    cards.push(
      card({
        type: "query",
        skillId: "risk_query",
        title: "High-risk employees",
        summary: high.length
          ? `${high.length} employee(s) in red band (≥70).`
          : "No employees in red risk band.",
        band: high.length ? "red" : "green",
        rows,
      })
    );
  }

  if (intent === "payroll_leakage") {
    skillsUsed.push("leakage_query");
    const rows =
      context.costDashboard?.employeeDayCosts
        .filter((d) => d.leakageValue >= 100)
        .sort((a, b) => b.leakageValue - a.leakageValue)
        .map((d) => ({
          label: labelFor(d.employeeId),
          value: `R${Math.round(d.leakageValue)} leakage`,
          meta: `Travel R${Math.round(d.travelCost)} · Idle R${Math.round(d.idleCost)}`,
        })) || [];
    cards.push(
      card({
        type: "query",
        skillId: "leakage_query",
        title: "Payroll leakage risks",
        summary: rows.length
          ? `${rows.length} employee(s) with elevated leakage on ${today}.`
          : "No significant payroll leakage detected today.",
        band: rows.length ? "red" : "green",
        rows,
      })
    );
  }

  if (intent === "report_attendance") {
    skillsUsed.push("attendance_report");
    const weekChecks = context.payrollClockChecks.filter((c) => c.shift_date >= today);
    const lateCount = weekChecks.filter((c) => Number(c.late_minutes || 0) > 0).length;
    const missingIn = weekChecks.filter((c) => c.missing_clock_in).length;
    const missingOut = weekChecks.filter((c) => c.missing_clock_out).length;
    const reportText = [
      `ATTENDANCE REPORT — ${context.companyId.slice(0, 8)}…`,
      `Date: ${today}`,
      ``,
      `Late flags (7d): ${lateCount}`,
      `Missing clock-in: ${missingIn}`,
      `Missing clock-out: ${missingOut}`,
      `Employees monitored: ${context.employees.length}`,
    ].join("\n");
    cards.push(
      card({
        type: "report",
        skillId: "attendance_report",
        title: "Attendance report",
        summary: `7-day attendance snapshot generated for ${context.employees.length} employees.`,
        reportText,
      })
    );
  }

  if (intent === "report_overtime") {
    skillsUsed.push("overtime_report");
    const otRows = context.payrollClockChecks
      .filter((c) => Number(c.overtime_minutes || 0) > 0)
      .map((c) => `${labelFor(c.employee_id)}: ${c.overtime_minutes} min OT (${c.shift_date})`);
    const reportText = [
      `OVERTIME REPORT — ${today}`,
      ``,
      ...otRows.slice(0, 30),
      otRows.length > 30 ? `…and ${otRows.length - 30} more` : "",
    ].join("\n");
    cards.push(
      card({
        type: "report",
        skillId: "overtime_report",
        title: "Overtime report",
        summary: `${otRows.length} overtime line(s) in payroll clock checks.`,
        reportText,
      })
    );
  }

  if (intent === "report_workforce_risk") {
    skillsUsed.push("risk_report");
    const dash = context.riskDashboard;
    const reportText = [
      `WORKFORCE RISK REPORT — ${today}`,
      `Index: ${dash?.workforceRiskIndex ?? 0}/100`,
      `Green: ${dash?.greenCount ?? 0} · Amber: ${dash?.amberCount ?? 0} · Red: ${dash?.redCount ?? 0}`,
      ``,
      `Top risk employees:`,
      ...(dash?.topRiskEmployees.slice(0, 8).map(
        (e) => `  • ${e.entityLabel} — ${e.overallScore}/100 (${e.riskBand})`
      ) || []),
    ].join("\n");
    cards.push(
      card({
        type: "report",
        skillId: "risk_report",
        title: "Workforce risk report",
        summary: `Risk index ${dash?.workforceRiskIndex ?? 0}/100 across workforce.`,
        band: scoreToRiskBand(dash?.workforceRiskIndex ?? 0),
        reportText,
      })
    );
  }

  if (intent === "report_field_ops") {
    skillsUsed.push("field_ops_report");
    const snap = context.fieldSnapshot;
    const reportText = [
      `FIELD OPERATIONS REPORT — ${today}`,
      `Jobs: ${snap?.jobs.length ?? 0}`,
      `Events today: ${snap?.events.filter((e) => e.recordedAt.startsWith(today)).length ?? 0}`,
      `Active shifts: ${snap?.shifts.filter((s) => s.status === "active").length ?? 0}`,
      `Journey alerts: ${context.journeyDashboard?.alerts.length ?? 0}`,
    ].join("\n");
    cards.push(
      card({
        type: "report",
        skillId: "field_ops_report",
        title: "Field operations report",
        summary: "Field jobs, events, and journey alert summary.",
        reportText,
      })
    );
  }

  if (intent === "report_labour_cost") {
    skillsUsed.push("labour_cost_report");
    const cost = context.costDashboard;
    const reportText = [
      `LABOUR COST REPORT — ${today}`,
      `Total cost: R${Math.round(cost?.totalCost ?? 0)}`,
      `Labour: R${Math.round(cost?.labourCost ?? 0)}`,
      `Travel: R${Math.round(cost?.travelCost ?? 0)}`,
      `Idle: R${Math.round(cost?.idleCost ?? 0)}`,
      `Leakage: R${Math.round(cost?.estimatedLeakage ?? 0)}`,
    ].join("\n");
    cards.push(
      card({
        type: "report",
        skillId: "labour_cost_report",
        title: "Labour cost report",
        summary: `Total labour cost R${Math.round(cost?.totalCost ?? 0)} for ${today}.`,
        reportText,
      })
    );
  }

  const actionIntents: CopilotIntent[] = [
    "action_create_warning",
    "action_create_hr_case",
    "action_approve_leave",
    "action_reject_leave",
    "action_assign_employee",
    "action_move_employee",
  ];

  if (actionIntents.includes(intent)) {
    const nameToken = extractNameFromCommand(command);
    const employee = nameToken ? findEmployeeByToken(context.employees, nameToken) : null;

    if (intent === "action_create_warning") {
      skillsUsed.push("hr_warning_action");
      cards.push(
        card({
          type: "action",
          skillId: "hr_warning_action",
          title: "Create warning",
          summary: employee
            ? `Ready to create HR warning for ${empLabel(employee)}. Confirmation required.`
            : "Specify employee name in command, e.g. “Create warning for Jane Doe”.",
          action: employee
            ? {
                actionType: "create_warning",
                title: "Create warning",
                description: `Issue verbal warning for ${empLabel(employee)}.`,
                payload: {
                  employee_id: employee.id,
                  employee_name: empLabel(employee),
                  warning_type: "verbal",
                  incident_type: "late_coming",
                  severity: "medium",
                  description: `Created via Workforce AI Copilot: ${command}`,
                },
              }
            : undefined,
        })
      );
    }

    if (intent === "action_create_hr_case") {
      skillsUsed.push("hr_case_action");
      cards.push(
        card({
          type: "action",
          skillId: "hr_case_action",
          title: "Create HR case",
          summary: employee
            ? `Ready to open HR case for ${empLabel(employee)}. Confirmation required.`
            : "Specify employee name, e.g. “Create HR case for John Smith”.",
          action: employee
            ? {
                actionType: "create_hr_case",
                title: "Create HR case",
                description: `Open disciplinary case for ${empLabel(employee)}.`,
                payload: {
                  employee_id: employee.id,
                  case_type: "disciplinary",
                  title: `Copilot case — ${empLabel(employee)}`,
                  description: command,
                },
              }
            : undefined,
        })
      );
    }

    if (intent === "action_approve_leave" || intent === "action_reject_leave") {
      const skill =
        intent === "action_approve_leave" ? "leave_approve_action" : "leave_reject_action";
      skillsUsed.push(skill);
      const pending = context.leaveRequests.filter((l) => {
        const status = (l.status || "").toLowerCase();
        if (!["pending", "submitted"].includes(status)) return false;
        if (!employee) return true;
        return l.employee_id === employee.id;
      });
      const target = employee
        ? pending.find((l) => l.employee_id === employee.id)
        : pending[0];
      cards.push(
        card({
          type: "action",
          skillId: skill,
          title: intent === "action_approve_leave" ? "Approve leave" : "Reject leave",
          summary: target
            ? `${intent === "action_approve_leave" ? "Approve" : "Reject"} leave for ${target.employee_name || labelFor(target.employee_id)} (${target.start_date} → ${target.end_date}). Confirmation required.`
            : "No matching pending leave request found.",
          action: target
            ? {
                actionType: intent === "action_approve_leave" ? "approve_leave" : "reject_leave",
                title: intent === "action_approve_leave" ? "Approve leave" : "Reject leave",
                description: `Update leave request status for ${target.employee_name || labelFor(target.employee_id)}.`,
                payload: {
                  leave_request_id: target.id,
                  status: intent === "action_approve_leave" ? "approved" : "declined",
                  manager_feedback: `Decision via Workforce AI Copilot.`,
                },
              }
            : undefined,
        })
      );
    }

    if (intent === "action_assign_employee") {
      skillsUsed.push("job_assign_action");
      const jobRefMatch = command.match(/job\s+([a-z0-9-]+)/i);
      const job = jobRefMatch
        ? context.fieldSnapshot?.jobs.find(
            (j) => j.jobRef.toLowerCase() === jobRefMatch[1].toLowerCase()
          )
        : context.fieldSnapshot?.jobs.find((j) => j.status === "Pending");
      cards.push(
        card({
          type: "action",
          skillId: "job_assign_action",
          title: "Assign employee",
          summary:
            employee && job
              ? `Assign ${empLabel(employee)} to ${job.jobRef}. Confirmation required.`
              : "Use: “Assign employee [name] to job [ref]”.",
          action:
            employee && job
              ? {
                  actionType: "assign_employee",
                  title: "Assign employee",
                  description: `Assign ${empLabel(employee)} to job ${job.jobRef}.`,
                  payload: {
                    job_id: job.id,
                    employee_id: employee.id,
                    role: "primary",
                  },
                }
              : undefined,
        })
      );
    }

    if (intent === "action_move_employee") {
      skillsUsed.push("employee_move_action");
      const storeMatch = command.match(/store\s+(.+)$/i);
      const store = storeMatch
        ? context.stores.find((s) =>
            s.name.toLowerCase().includes(storeMatch[1].toLowerCase().trim())
          )
        : context.stores[0];
      cards.push(
        card({
          type: "action",
          skillId: "employee_move_action",
          title: "Move employee",
          summary:
            employee && store
              ? `Move ${empLabel(employee)} to ${store.name}. Confirmation required.`
              : "Use: “Move employee [name] to store [store name]”.",
          action:
            employee && store
              ? {
                  actionType: "move_employee",
                  title: "Move employee",
                  description: `Update default store for ${empLabel(employee)} to ${store.name}.`,
                  payload: {
                    employee_id: employee.id,
                    store_id: store.id,
                    store_name: store.name,
                  },
                }
              : undefined,
        })
      );
    }
  }

  if (intent === "unknown") {
    cards.push(
      card({
        type: "info",
        title: "Command not recognised",
        summary:
          "Try a suggested prompt below, or use phrases like “Who is late today?” or “Generate attendance report.”",
      })
    );
  }

  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intent,
    command,
    cards,
    skillsUsed,
  };
}

/** @deprecated Use workforce-automation-engine prepare + approve flow instead. */
export async function executeCopilotAction(
  supabase: SupabaseClient,
  companyId: string,
  action: CopilotActionProposal
): Promise<{ ok: boolean; message: string }> {
  const p = action.payload;

  if (action.actionType === "create_warning") {
    const warningDescription = p.employee_name
      ? `[${p.employee_name}] ${String(p.description || "Created via AI Copilot")}`
      : String(p.description || "Created via AI Copilot");
    const { error } = await supabase.from("hr_warnings").insert({
      company_id: companyId,
      employee_id: p.employee_id,
      warning_type: p.warning_type || "verbal",
      incident_type: p.incident_type || "other",
      incident_date: todayIsoDate(),
      issue_date: todayIsoDate(),
      expiry_date: todayIsoDate(),
      severity: p.severity || "medium",
      description: warningDescription,
      status: "active",
    });
    return { ok: !error, message: error?.message || "HR warning created." };
  }

  if (action.actionType === "create_hr_case") {
    const { error } = await supabase.from("hr_cases").insert({
      company_id: companyId,
      employee_id: p.employee_id,
      case_type: p.case_type || "disciplinary",
      title: p.title || "Copilot HR case",
      description: p.description || "",
      validity_status: "waiting_for_employee",
      status: "open",
      employee_response_required: true,
    });
    return { ok: !error, message: error?.message || "HR case created." };
  }

  if (action.actionType === "approve_leave" || action.actionType === "reject_leave") {
    const { error } = await supabase
      .from("leave_requests")
      .update({
        status: p.status,
        manager_feedback: p.manager_feedback || null,
      })
      .eq("id", p.leave_request_id);
    return {
      ok: !error,
      message: error?.message || `Leave ${p.status === "approved" ? "approved" : "rejected"}.`,
    };
  }

  if (action.actionType === "assign_employee") {
    const { error } = await supabase.from("field_job_assignments").insert({
      company_id: companyId,
      job_id: p.job_id,
      employee_id: p.employee_id,
      role: p.role || "primary",
      status: "assigned",
      assigned_at: new Date().toISOString(),
    });
    return { ok: !error, message: error?.message || "Employee assigned to job." };
  }

  if (action.actionType === "move_employee") {
    const { error } = await supabase
      .from("employees")
      .update({ default_store_id: p.store_id })
      .eq("id", p.employee_id)
      .eq("company_id", companyId);
    return {
      ok: !error,
      message: error?.message || `Employee moved to ${p.store_name || "store"}.`,
    };
  }

  return { ok: false, message: "Unknown action type." };
}
