/**
 * VYRON CORE Phase 5B — Workforce Automation Engine.
 * Prepares actions from AI recommendations; requires manager approval before commit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import { createFieldJob } from "@/lib/field-operations";
import type { CopilotActionProposal } from "@/lib/workforce-ai-copilot";
import {
  orchestrateWorkflow,
  type WorkflowPipelineStage,
  type WorkflowTrigger,
} from "@/lib/workflow-orchestration-engine";

export const AUTOMATION_ACTION_TYPES = [
  "Create Warning",
  "Create HR Case",
  "Approve Leave",
  "Reject Leave",
  "Assign Employee",
  "Move Employee",
  "Create Roster Change",
  "Create Field Job",
  "Escalate Exception",
  "Mark Payroll Item For Review",
] as const;

export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const AUTOMATION_ACTION_STATUSES = [
  "Draft",
  "Pending Approval",
  "Assigned",
  "Awaiting Approval",
  "Approved",
  "In Progress",
  "Rejected",
  "Completed",
  "Verified",
  "Closed",
  "Cancelled",
  "Failed",
] as const;

export type AutomationActionStatus = (typeof AUTOMATION_ACTION_STATUSES)[number];

const AUTOMATION_TABLES = [
  "workforce_automation_actions",
  "workforce_automation_approvals",
  "workforce_automation_audit_log",
] as const;

export type WorkforceAutomationAction = {
  id: string;
  company_id: string;
  action_type: AutomationActionType;
  status: AutomationActionStatus;
  employee_id: string | null;
  manager_id: string | null;
  prepared_by: string | null;
  source_module: string;
  reason: string;
  payload_json: Record<string, unknown>;
  trigger_type?: WorkflowTrigger | null;
  pipeline_stage?: WorkflowPipelineStage | null;
  workflow_owner?: string | null;
  created_by?: string | null;
  duration_minutes?: number | null;
  outcome_summary?: string | null;
  outcome_before_json?: Record<string, unknown> | null;
  outcome_after_json?: Record<string, unknown> | null;
  impact_estimate_json?: Record<string, unknown> | null;
  notification_channels?: string[] | null;
  task_list_json?: Record<string, unknown>[] | null;
  approval_roles?: string[] | null;
  escalation_level?: "Critical" | "High" | "Medium" | "Low" | null;
  error_message: string | null;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type WorkforceAutomationApproval = {
  id: string;
  action_id: string;
  approver_email: string;
  decision: "approved" | "rejected";
  notes: string | null;
  decided_at: string;
};

export type WorkforceAutomationAuditEntry = {
  id: string;
  action_id: string | null;
  event_type: string;
  actor_email: string | null;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type WorkforceAutomationDashboard = {
  pendingAiActions: WorkforceAutomationAction[];
  approvalQueue: WorkforceAutomationAction[];
  openWorkflows: WorkforceAutomationAction[];
  criticalWorkflows: WorkforceAutomationAction[];
  overdueWorkflows: WorkforceAutomationAction[];
  completedActions: WorkforceAutomationAction[];
  failedActions: WorkforceAutomationAction[];
  metrics: {
    openCount: number;
    criticalCount: number;
    overdueCount: number;
    completedCount: number;
    averageResolutionMinutes: number;
    automationSuccessRatePct: number;
    businessImpactZAR: number;
    timeSavedHours: number;
    payrollRiskReductionPct: number;
    operationalImprovementScore: number;
  };
  tablesAvailable: boolean;
};

function safeN(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function durationMinutes(createdAt: string, completedAt?: string | null): number {
  const start = Date.parse(createdAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 60_000);
}

function deriveEscalationLevel(
  impact: number,
  trigger: WorkflowTrigger | null | undefined,
): "Critical" | "High" | "Medium" | "Low" {
  if (impact >= 7000 || trigger === "Payroll Blocked" || trigger === "Compliance Failure") return "Critical";
  if (impact >= 3500) return "High";
  if (impact >= 1200) return "Medium";
  return "Low";
}

function mapActionTypeToTrigger(actionType: AutomationActionType): WorkflowTrigger {
  const map: Record<AutomationActionType, WorkflowTrigger> = {
    "Create Warning": "Warning Issued",
    "Create HR Case": "HR Case Created",
    "Approve Leave": "Leave Approved",
    "Reject Leave": "Leave Rejected",
    "Assign Employee": "Employee Updated",
    "Move Employee": "Employee Transferred",
    "Create Roster Change": "Roster Changed",
    "Create Field Job": "Workforce Intelligence Alert",
    "Escalate Exception": "Compliance Failure",
    "Mark Payroll Item For Review": "Payroll Blocked",
  };
  return map[actionType];
}

function isAutomationMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return AUTOMATION_TABLES.some((t) => isSupabaseMissingTableError(error, t));
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function copilotActionToAutomationType(
  actionType: CopilotActionProposal["actionType"]
): AutomationActionType {
  const map: Record<CopilotActionProposal["actionType"], AutomationActionType> = {
    create_warning: "Create Warning",
    create_hr_case: "Create HR Case",
    approve_leave: "Approve Leave",
    reject_leave: "Reject Leave",
    assign_employee: "Assign Employee",
    move_employee: "Move Employee",
  };
  return map[actionType];
}

export function automationTypeLabel(type: AutomationActionType): string {
  return type;
}

async function writeAuditLog(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actionId?: string | null;
    eventType: string;
    actorEmail?: string | null;
    message: string;
    metadata?: Record<string, unknown>;
  }
): Promise<string | null> {
  const { error } = await supabase.from("workforce_automation_audit_log").insert({
    company_id: input.companyId,
    action_id: input.actionId || null,
    event_type: input.eventType,
    actor_email: input.actorEmail || null,
    message: input.message,
    metadata: input.metadata || {},
  });
  if (error && !isAutomationMissingTableError(error)) return error.message;
  return null;
}

export async function prepareAutomationAction(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actionType: AutomationActionType;
    employeeId?: string | null;
    managerId?: string | null;
    preparedByEmail: string;
    sourceModule?: string;
    reason: string;
    payload: Record<string, unknown>;
    submitToQueue?: boolean;
    triggerType?: WorkflowTrigger;
    createdBy?: string;
  }
): Promise<{ action: WorkforceAutomationAction | null; error: string | null }> {
  const now = new Date().toISOString();
  const status: AutomationActionStatus = input.submitToQueue ? "Pending Approval" : "Draft";
  const triggerType = input.triggerType || mapActionTypeToTrigger(input.actionType);

  const orchestration = orchestrateWorkflow({
    trigger: triggerType,
    companyId: input.companyId,
    employeeId: input.employeeId || null,
    employeeName: (input.payload.employee_name as string | undefined) || null,
    department: (input.payload.department as string | undefined) || null,
    managerEmail: (input.payload.manager_email as string | undefined) || null,
    supervisorEmail: (input.payload.supervisor_email as string | undefined) || null,
    sourceModule: input.sourceModule || "Workforce AI Copilot",
    createdBy: input.createdBy || input.preparedByEmail,
    evidence: {
      lateMinutes: input.payload.late_minutes,
      overtimeHours: input.payload.overtime_hours,
      blockerCount: input.payload.blocker_count,
      missingClockEvents: input.payload.missing_clock_events,
      unresolvedCases: input.payload.unresolved_cases,
      payrollBlockers: input.payload.blocker_count,
      signalStrength: input.payload.signal_strength,
      lateArrivals: input.payload.late_arrivals,
      complianceBreaches: input.payload.compliance_breaches,
    },
  });
  const escalationLevel = deriveEscalationLevel(
    safeN(orchestration.impactEstimate.financialImpactZAR),
    triggerType,
  );
  const actionOwner = orchestration.owner || input.managerId || input.preparedByEmail;

  const { data, error } = await supabase
    .from("workforce_automation_actions")
    .insert({
      company_id: input.companyId,
      action_type: input.actionType,
      status,
      employee_id: input.employeeId || null,
      manager_id: input.managerId || null,
      prepared_by: input.preparedByEmail,
      source_module: input.sourceModule || "Workforce AI Copilot",
      reason: input.reason,
      payload_json: input.payload,
      trigger_type: triggerType,
      pipeline_stage: status === "Pending Approval" ? "Awaiting Approval" : orchestration.stage,
      workflow_owner: actionOwner,
      created_by: input.createdBy || input.preparedByEmail,
      outcome_summary: orchestration.expectedOutcome,
      outcome_before_json: orchestration.beforeMetrics,
      impact_estimate_json: orchestration.impactEstimate,
      notification_channels: orchestration.notifications,
      task_list_json: orchestration.tasks.map((task) => ({ task, status: "prepared" })),
      approval_roles: orchestration.approvalsRequired,
      escalation_level: escalationLevel,
      updated_at: now,
    })
    .select("*")
    .single();

  if (error || !data) {
    return {
      action: null,
      error: error?.message || "Failed to prepare automation action.",
    };
  }

  const action = data as WorkforceAutomationAction;
  await writeAuditLog(supabase, {
    companyId: input.companyId,
    actionId: action.id,
    eventType: status === "Draft" ? "action_prepared" : "submitted_for_approval",
    actorEmail: input.preparedByEmail,
    message:
      status === "Draft"
        ? `${input.actionType} prepared as draft.`
        : `${input.actionType} sent to approval queue.`,
    metadata: {
      action_type: input.actionType,
      status,
      trigger_type: triggerType,
      workflow_owner: actionOwner,
      escalation_level: escalationLevel,
      approvals_required: orchestration.approvalsRequired,
      expected_outcome: orchestration.expectedOutcome,
    },
  });

  return { action, error: null };
}

export async function prepareFromCopilotProposal(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    proposal: CopilotActionProposal;
    preparedByEmail: string;
    reason: string;
    submitToQueue?: boolean;
  }
): Promise<{ action: WorkforceAutomationAction | null; error: string | null }> {
  const payload = input.proposal.payload;
  const employeeId =
    (payload.employee_id as string | undefined) ||
    (payload.leave_request_id ? undefined : null) ||
    null;

  return prepareAutomationAction(supabase, {
    companyId: input.companyId,
    actionType: copilotActionToAutomationType(input.proposal.actionType),
    employeeId: employeeId || (payload.employee_id as string) || null,
    preparedByEmail: input.preparedByEmail,
    sourceModule: "Workforce AI Copilot",
    reason: input.reason || input.proposal.description,
    payload,
    submitToQueue: input.submitToQueue,
  });
}

export async function submitAutomationToQueue(
  supabase: SupabaseClient,
  actionId: string,
  companyId: string,
  actorEmail: string
): Promise<{ ok: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("workforce_automation_actions")
    .update({
      status: "Pending Approval",
      pipeline_stage: "Awaiting Approval",
      workflow_owner: actorEmail,
      updated_at: now,
    })
    .eq("id", actionId)
    .eq("company_id", companyId)
    .in("status", ["Draft"]);

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAuditLog(supabase, {
    companyId,
    actionId,
    eventType: "submitted_for_approval",
    actorEmail,
    message: "Action submitted to approval queue.",
  });

  return { ok: true, error: null };
}

export async function executeWorkforceActionPayload(
  supabase: SupabaseClient,
  companyId: string,
  actionType: AutomationActionType,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; message: string }> {
  const p = payload;

  if (actionType === "Create Warning") {
    const warningDescription = p.employee_name
      ? `[${p.employee_name}] ${String(p.description || "Created via automation engine")}`
      : String(p.description || "Created via automation engine");
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

  if (actionType === "Create HR Case") {
    const { error } = await supabase.from("hr_cases").insert({
      company_id: companyId,
      employee_id: p.employee_id,
      case_type: p.case_type || "disciplinary",
      title: p.title || "Automation HR case",
      description: p.description || "",
      validity_status: "waiting_for_employee",
      status: "open",
      employee_response_required: true,
    });
    return { ok: !error, message: error?.message || "HR case created." };
  }

  if (actionType === "Approve Leave" || actionType === "Reject Leave") {
    const { error } = await supabase
      .from("leave_requests")
      .update({
        status: actionType === "Approve Leave" ? "approved" : "declined",
        manager_feedback: (p.manager_feedback as string) || "Decision via automation engine.",
      })
      .eq("id", p.leave_request_id);
    return {
      ok: !error,
      message:
        error?.message ||
        `Leave ${actionType === "Approve Leave" ? "approved" : "rejected"}.`,
    };
  }

  if (actionType === "Assign Employee") {
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

  if (actionType === "Move Employee") {
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

  if (actionType === "Create Roster Change") {
    if (p.roster_shift_id) {
      const { error } = await supabase
        .from("roster_shifts")
        .update({
          employee_id: p.employee_id,
          store_id: p.store_id || undefined,
          shift_date: p.shift_date || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.roster_shift_id)
        .eq("company_id", companyId);
      return { ok: !error, message: error?.message || "Roster shift updated." };
    }
    const { error } = await supabase.from("roster_shifts").insert({
      company_id: companyId,
      employee_id: p.employee_id,
      store_id: p.store_id,
      shift_date: p.shift_date || todayIsoDate(),
      planned_start: p.planned_start || `${p.shift_date || todayIsoDate()}T09:00:00`,
      planned_end: p.planned_end || `${p.shift_date || todayIsoDate()}T17:00:00`,
      status: "scheduled",
    });
    return { ok: !error, message: error?.message || "Roster shift created." };
  }

  if (actionType === "Create Field Job") {
    const result = await createFieldJob(supabase, {
      companyId,
      title: (p.title as string) || "Copilot field job",
      description: (p.description as string) || undefined,
      siteType: (p.site_type as "fixed_site") || "fixed_site",
      storeId: (p.store_id as string) || null,
      customerName: (p.customer_name as string) || null,
      employeeId: (p.employee_id as string) || null,
    });
    return {
      ok: !result.error,
      message: result.error || `Field job ${result.job?.jobRef || ""} created.`,
    };
  }

  if (actionType === "Escalate Exception") {
    const { error } = await supabase
      .from("time_exceptions")
      .update({
        status: "escalated",
        severity: p.severity || "high",
        updated_at: new Date().toISOString(),
      })
      .eq("id", p.exception_id)
      .eq("company_id", companyId);
    return { ok: !error, message: error?.message || "Exception escalated." };
  }

  if (actionType === "Mark Payroll Item For Review") {
    if (p.payroll_clock_check_id) {
      const { error } = await supabase
        .from("payroll_clock_checks")
        .update({
          exception_required: true,
          payroll_status: "needs_review",
        })
        .eq("id", p.payroll_clock_check_id);
      return { ok: !error, message: error?.message || "Payroll clock check flagged." };
    }
    const { error } = await supabase
      .from("payroll_hours")
      .update({ status: "needs_review" })
      .eq("employee_id", p.employee_id)
      .eq("company_id", companyId);
    return { ok: !error, message: error?.message || "Payroll item marked for review." };
  }

  return { ok: false, message: `Unsupported action type: ${actionType}` };
}

export async function approveAutomationAction(
  supabase: SupabaseClient,
  input: {
    actionId: string;
    companyId: string;
    approverEmail: string;
    notes?: string;
  }
): Promise<{ ok: boolean; error: string | null; message?: string }> {
  const { data: actionRow, error: fetchError } = await supabase
    .from("workforce_automation_actions")
    .select("*")
    .eq("id", input.actionId)
    .eq("company_id", input.companyId)
    .single();

  if (fetchError || !actionRow) {
    return { ok: false, error: fetchError?.message || "Action not found." };
  }

  const action = actionRow as WorkforceAutomationAction;
  if (action.status !== "Pending Approval") {
    return { ok: false, error: `Action is not pending approval (status: ${action.status}).` };
  }

  const now = new Date().toISOString();

  const { error: approvalError } = await supabase.from("workforce_automation_approvals").insert({
    action_id: action.id,
    company_id: input.companyId,
    approver_email: input.approverEmail,
    decision: "approved",
    notes: input.notes?.trim() || null,
  });

  if (approvalError) {
    return { ok: false, error: approvalError.message };
  }

  await supabase
    .from("workforce_automation_actions")
    .update({
      status: "Approved",
      pipeline_stage: "Approved",
      manager_id: input.approverEmail,
      workflow_owner: input.approverEmail,
      approved_at: now,
      updated_at: now,
    })
    .eq("id", action.id);

  await supabase
    .from("workforce_automation_actions")
    .update({
      status: "In Progress",
      pipeline_stage: "In Progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.id)
    .eq("company_id", input.companyId);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    actionId: action.id,
    eventType: "approved",
    actorEmail: input.approverEmail,
    message: `${action.action_type} approved by manager.`,
    metadata: { notes: input.notes || null },
  });

  const exec = await executeWorkforceActionPayload(
    supabase,
    input.companyId,
    action.action_type,
    action.payload_json
  );

  if (exec.ok) {
    const nowComplete = new Date().toISOString();
    const before = (action.outcome_before_json || {}) as Record<string, unknown>;
    const after = {
      ...before,
      resolvedAt: nowComplete,
      payrollBlockers: Math.max(0, safeN(before.payrollBlockers) - 1),
      overtimeHours: Math.max(0, safeN(before.overtimeHours) - 0.5),
      complianceBreaches: Math.max(0, safeN(before.complianceBreaches) - 1),
    };
    const dur = durationMinutes(action.created_at, nowComplete);

    await supabase
      .from("workforce_automation_actions")
      .update({
        status: "Verified",
        pipeline_stage: "Verified",
        completed_at: nowComplete,
        duration_minutes: dur,
        outcome_after_json: after,
        error_message: null,
        updated_at: nowComplete,
      })
      .eq("id", action.id);

    await writeAuditLog(supabase, {
      companyId: input.companyId,
      actionId: action.id,
      eventType: "completed",
      actorEmail: input.approverEmail,
      message: exec.message,
      metadata: {
        duration_minutes: dur,
        outcome_achieved: true,
      },
    });

    return { ok: true, error: null, message: exec.message };
  }

  await supabase
    .from("workforce_automation_actions")
    .update({
      status: "Failed",
      pipeline_stage: "Cancelled",
      error_message: exec.message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.id);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    actionId: action.id,
    eventType: "failed",
    actorEmail: input.approverEmail,
    message: exec.message,
    metadata: { phase: "execution" },
  });

  return { ok: false, error: exec.message, message: exec.message };
}

export async function rejectAutomationAction(
  supabase: SupabaseClient,
  input: {
    actionId: string;
    companyId: string;
    approverEmail: string;
    notes?: string;
  }
): Promise<{ ok: boolean; error: string | null }> {
  const { error: approvalError } = await supabase.from("workforce_automation_approvals").insert({
    action_id: input.actionId,
    company_id: input.companyId,
    approver_email: input.approverEmail,
    decision: "rejected",
    notes: input.notes?.trim() || null,
  });

  if (approvalError) {
    return { ok: false, error: approvalError.message };
  }

  const { error } = await supabase
    .from("workforce_automation_actions")
    .update({
      status: "Rejected",
      pipeline_stage: "Cancelled",
      manager_id: input.approverEmail,
      workflow_owner: input.approverEmail,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.actionId)
    .eq("company_id", input.companyId)
    .eq("status", "Pending Approval");

  if (error) {
    return { ok: false, error: error.message };
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    actionId: input.actionId,
    eventType: "rejected",
    actorEmail: input.approverEmail,
    message: "Action rejected by manager.",
    metadata: { notes: input.notes || null },
  });

  return { ok: true, error: null };
}

export async function retryFailedAutomationAction(
  supabase: SupabaseClient,
  input: {
    actionId: string;
    companyId: string;
    actorEmail: string;
  }
): Promise<{ ok: boolean; error: string | null; message?: string }> {
  const { data: actionRow, error: fetchError } = await supabase
    .from("workforce_automation_actions")
    .select("*")
    .eq("id", input.actionId)
    .eq("company_id", input.companyId)
    .single();

  if (fetchError || !actionRow) {
    return { ok: false, error: fetchError?.message || "Action not found." };
  }

  const action = actionRow as WorkforceAutomationAction;
  if (action.status !== "Failed") {
    return { ok: false, error: "Only failed actions can be retried." };
  }

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    actionId: action.id,
    eventType: "retry",
    actorEmail: input.actorEmail,
    message: `Retrying ${action.action_type}.`,
  });

  const exec = await executeWorkforceActionPayload(
    supabase,
    input.companyId,
    action.action_type,
    action.payload_json
  );

  if (exec.ok) {
    const nowComplete = new Date().toISOString();
    const before = (action.outcome_before_json || {}) as Record<string, unknown>;
    const after = {
      ...before,
      resolvedAt: nowComplete,
      retrySucceeded: true,
    };
    const dur = durationMinutes(action.created_at, nowComplete);

    await supabase
      .from("workforce_automation_actions")
      .update({
        status: "Verified",
        pipeline_stage: "Verified",
        completed_at: nowComplete,
        duration_minutes: dur,
        outcome_after_json: after,
        error_message: null,
        updated_at: nowComplete,
      })
      .eq("id", action.id);

    await writeAuditLog(supabase, {
      companyId: input.companyId,
      actionId: action.id,
      eventType: "completed",
      actorEmail: input.actorEmail,
      message: exec.message,
      metadata: { retry: true },
    });

    return { ok: true, error: null, message: exec.message };
  }

  await supabase
    .from("workforce_automation_actions")
    .update({
      error_message: exec.message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", action.id);

  await writeAuditLog(supabase, {
    companyId: input.companyId,
    actionId: action.id,
    eventType: "failed",
    actorEmail: input.actorEmail,
    message: exec.message,
    metadata: { retry: true },
  });

  return { ok: false, error: exec.message, message: exec.message };
}

export async function loadWorkforceAutomationDashboard(
  supabase: SupabaseClient,
  companyId: string
): Promise<{ dashboard: WorkforceAutomationDashboard; error: string | null }> {
  const { data, error } = await supabase
    .from("workforce_automation_actions")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    if (isAutomationMissingTableError(error)) {
      return {
        dashboard: {
          pendingAiActions: [],
          approvalQueue: [],
          openWorkflows: [],
          criticalWorkflows: [],
          overdueWorkflows: [],
          completedActions: [],
          failedActions: [],
          metrics: {
            openCount: 0,
            criticalCount: 0,
            overdueCount: 0,
            completedCount: 0,
            averageResolutionMinutes: 0,
            automationSuccessRatePct: 0,
            businessImpactZAR: 0,
            timeSavedHours: 0,
            payrollRiskReductionPct: 0,
            operationalImprovementScore: 0,
          },
          tablesAvailable: false,
        },
        error: null,
      };
    }
    return {
      dashboard: {
        pendingAiActions: [],
        approvalQueue: [],
        openWorkflows: [],
        criticalWorkflows: [],
        overdueWorkflows: [],
        completedActions: [],
        failedActions: [],
        metrics: {
          openCount: 0,
          criticalCount: 0,
          overdueCount: 0,
          completedCount: 0,
          averageResolutionMinutes: 0,
          automationSuccessRatePct: 0,
          businessImpactZAR: 0,
          timeSavedHours: 0,
          payrollRiskReductionPct: 0,
          operationalImprovementScore: 0,
        },
        tablesAvailable: true,
      },
      error: error.message,
    };
  }

  const actions = (data || []) as WorkforceAutomationAction[];
  const openWorkflows = actions.filter(
    (a) =>
      ![
        "Completed",
        "Verified",
        "Closed",
        "Cancelled",
        "Failed",
        "Rejected",
      ].includes(a.status),
  );
  const criticalWorkflows = actions.filter((a) => (a.escalation_level || "") === "Critical");
  const overdueWorkflows = openWorkflows.filter(
    (a) => durationMinutes(a.created_at, null) > 48 * 60,
  );
  const completed = actions.filter((a) => ["Completed", "Verified", "Closed"].includes(a.status));
  const failed = actions.filter((a) => a.status === "Failed");
  const avgResolutionMinutes =
    completed.length > 0
      ? Math.round(
          completed.reduce(
            (sum, a) => sum + (a.duration_minutes || durationMinutes(a.created_at, a.completed_at)),
            0,
          ) / completed.length,
        )
      : 0;
  const totalProcessed = completed.length + failed.length;
  const automationSuccessRatePct =
    totalProcessed > 0 ? Math.round((completed.length / totalProcessed) * 1000) / 10 : 0;
  const businessImpactZAR = Math.round(
    completed.reduce(
      (sum, a) => sum + safeN((a.impact_estimate_json || {}).financialImpactZAR),
      0,
    ),
  );
  const timeSavedHours =
    Math.round(
      completed.reduce(
        (sum, a) => sum + safeN((a.impact_estimate_json || {}).timeSavedHours),
        0,
      ) * 10,
    ) / 10;
  const payrollRiskReductionPct =
    completed.length > 0
      ? Math.round(
          (completed.reduce(
            (sum, a) => sum + safeN((a.impact_estimate_json || {}).payrollRiskReductionPct),
            0,
          ) /
            completed.length) *
            10,
        ) / 10
      : 0;
  const operationalImprovementScore =
    completed.length > 0
      ? Math.round(
          (completed.reduce(
            (sum, a) => sum + safeN((a.impact_estimate_json || {}).operationalImprovementScore),
            0,
          ) /
            completed.length) *
            10,
        ) / 10
      : 0;
  const fromCopilot = (a: WorkforceAutomationAction) =>
    (a.source_module || "").toLowerCase().includes("copilot");

  return {
    dashboard: {
      pendingAiActions: actions.filter(
        (a) => a.status === "Draft" && fromCopilot(a)
      ),
      approvalQueue: actions.filter((a) => a.status === "Pending Approval"),
      openWorkflows,
      criticalWorkflows,
      overdueWorkflows,
      completedActions: completed,
      failedActions: actions.filter((a) => a.status === "Failed"),
      metrics: {
        openCount: openWorkflows.length,
        criticalCount: criticalWorkflows.length,
        overdueCount: overdueWorkflows.length,
        completedCount: completed.length,
        averageResolutionMinutes: avgResolutionMinutes,
        automationSuccessRatePct,
        businessImpactZAR,
        timeSavedHours,
        payrollRiskReductionPct,
        operationalImprovementScore,
      },
      tablesAvailable: true,
    },
    error: null,
  };
}

export function automationStatusClass(status: AutomationActionStatus): string {
  if (status === "Closed") return "bg-emerald-100 text-emerald-900 border-emerald-200";
  if (status === "Verified") return "bg-emerald-100 text-emerald-900 border-emerald-200";
  if (status === "Completed") return "bg-emerald-100 text-emerald-900 border-emerald-200";
  if (status === "Failed") return "bg-rose-100 text-rose-900 border-rose-200";
  if (status === "Rejected") return "bg-slate-100 text-slate-700 border-slate-200";
  if (status === "Cancelled") return "bg-slate-100 text-slate-700 border-slate-200";
  if (status === "In Progress") return "bg-cyan-100 text-cyan-900 border-cyan-200";
  if (status === "Pending Approval") return "bg-amber-100 text-amber-950 border-amber-200";
  if (status === "Awaiting Approval") return "bg-amber-100 text-amber-950 border-amber-200";
  if (status === "Assigned") return "bg-indigo-100 text-indigo-900 border-indigo-200";
  if (status === "Approved") return "bg-cyan-100 text-cyan-900 border-cyan-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}
