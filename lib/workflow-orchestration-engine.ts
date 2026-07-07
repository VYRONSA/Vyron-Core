export const WORKFLOW_TRIGGERS = [
  "Employee Created",
  "Employee Updated",
  "Employee Transferred",
  "Employee Terminated",
  "Clock In",
  "Clock Out",
  "Late Arrival",
  "Missed Clock",
  "Overtime",
  "Leave Submitted",
  "Leave Approved",
  "Leave Rejected",
  "Roster Published",
  "Roster Changed",
  "Payroll Blocked",
  "HR Case Created",
  "Warning Issued",
  "Document Expired",
  "Training Expired",
  "Certification Expired",
  "Compliance Failure",
  "Workforce Intelligence Alert",
  "Action Intelligence Alert",
] as const;

export type WorkflowTrigger = (typeof WORKFLOW_TRIGGERS)[number];

export const WORKFLOW_PIPELINE_STAGES = [
  "Triggered",
  "Prepared",
  "Assigned",
  "Awaiting Approval",
  "Approved",
  "In Progress",
  "Completed",
  "Verified",
  "Closed",
  "Cancelled",
] as const;

export type WorkflowPipelineStage = (typeof WORKFLOW_PIPELINE_STAGES)[number];

export const WORKFLOW_ACTION_LIBRARY = [
  "Create HR Case",
  "Create Counselling",
  "Issue Warning",
  "Assign Manager",
  "Create Follow-up Task",
  "Notify Supervisor",
  "Notify HR",
  "Notify Employee",
  "Schedule Review",
  "Schedule Meeting",
  "Request Supporting Documents",
  "Update Payroll Readiness",
  "Recalculate Workforce Intelligence",
  "Generate Executive Alert",
] as const;

export type WorkflowActionLibraryType = (typeof WORKFLOW_ACTION_LIBRARY)[number];

export type WorkflowOrchestrationInput = {
  trigger: WorkflowTrigger;
  companyId: string;
  employeeId?: string | null;
  employeeName?: string | null;
  department?: string | null;
  managerEmail?: string | null;
  supervisorEmail?: string | null;
  sourceModule: string;
  createdBy: string;
  evidence?: Record<string, unknown>;
};

export type WorkflowRecommendation = {
  workflowTitle: string;
  trigger: WorkflowTrigger;
  conditions: string[];
  businessRules: string[];
  recommendedActions: WorkflowActionLibraryType[];
  approvalsRequired: string[];
  notifications: string[];
  tasks: string[];
  owner: string;
  expectedOutcome: string;
  beforeMetrics: Record<string, number>;
  impactEstimate: {
    financialImpactZAR: number;
    timeSavedHours: number;
    payrollRiskReductionPct: number;
    operationalImprovementScore: number;
  };
  whyLikely: string;
  confidence: number;
  consequencesIfIgnored: string;
  autoPreparationSummary: string;
  stage: WorkflowPipelineStage;
};

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function n(value: unknown, fallback = 0): number {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

function s(value: unknown, fallback = ""): string {
  return value == null ? fallback : String(value);
}

function impactFromEvidence(trigger: WorkflowTrigger, evidence: Record<string, unknown>): WorkflowRecommendation["impactEstimate"] {
  const lateMinutes = n(evidence.lateMinutes);
  const overtimeHours = n(evidence.overtimeHours);
  const blockers = n(evidence.blockerCount);
  const missingClocks = n(evidence.missingClockEvents);
  const unresolvedCases = n(evidence.unresolvedCases);

  const baseFinancial =
    lateMinutes * 3.2 +
    overtimeHours * 115 +
    missingClocks * 240 +
    blockers * 420 +
    unresolvedCases * 160;

  const triggerMultiplier =
    trigger === "Payroll Blocked"
      ? 2.0
      : trigger === "Compliance Failure"
        ? 1.8
        : trigger === "Document Expired" || trigger === "Certification Expired"
          ? 1.5
          : trigger === "Late Arrival" || trigger === "Missed Clock"
            ? 1.2
            : 1.0;

  const financialImpactZAR = Math.round(baseFinancial * triggerMultiplier);
  const timeSavedHours = Number((1 + overtimeHours * 0.2 + blockers * 0.5 + missingClocks * 0.15).toFixed(2));
  const payrollRiskReductionPct = clamp(8 + blockers * 6 + missingClocks * 2 + (trigger === "Payroll Blocked" ? 20 : 0));
  const operationalImprovementScore = clamp(45 + overtimeHours * 2 + blockers * 4 + unresolvedCases * 3);

  return {
    financialImpactZAR,
    timeSavedHours,
    payrollRiskReductionPct,
    operationalImprovementScore,
  };
}

export function orchestrateWorkflow(input: WorkflowOrchestrationInput): WorkflowRecommendation {
  const ev = input.evidence || {};
  const employeeLabel = input.employeeName || input.employeeId || "Employee";
  const department = input.department || "Unassigned";
  const owner = input.managerEmail || input.supervisorEmail || "manager@workspace";

  const triggerRules: Record<WorkflowTrigger, { actions: WorkflowActionLibraryType[]; approvals: string[]; outcome: string; whyLikely: string }> = {
    "Employee Created": {
      actions: ["Assign Manager", "Create Follow-up Task", "Notify HR"],
      approvals: ["HR"],
      outcome: "New employee fully onboarded with ownership and compliance tasks in place.",
      whyLikely: "Onboarding events require assignment and compliance setup to avoid operational delays.",
    },
    "Employee Updated": {
      actions: ["Create Follow-up Task", "Notify Supervisor"],
      approvals: ["Manager"],
      outcome: "Employee profile changes reflected operationally without process drift.",
      whyLikely: "Critical profile updates can break roster, payroll, or supervision links if not actioned.",
    },
    "Employee Transferred": {
      actions: ["Assign Manager", "Schedule Review", "Notify HR"],
      approvals: ["Manager", "HR"],
      outcome: "Transfer executed with correct line ownership and post-transfer stability check.",
      whyLikely: "Transfers often introduce roster and accountability gaps in the first cycle.",
    },
    "Employee Terminated": {
      actions: ["Create Follow-up Task", "Update Payroll Readiness", "Notify HR"],
      approvals: ["HR", "Owner"],
      outcome: "Termination processed without payroll leakage or compliance gaps.",
      whyLikely: "Termination events can leave unresolved payroll and access obligations.",
    },
    "Clock In": {
      actions: ["Recalculate Workforce Intelligence"],
      approvals: ["Supervisor"],
      outcome: "Attendance telemetry updated with no exception leakage.",
      whyLikely: "Clock-in events feed readiness and attendance trend analytics.",
    },
    "Clock Out": {
      actions: ["Recalculate Workforce Intelligence"],
      approvals: ["Supervisor"],
      outcome: "End-of-shift metrics synced for payroll and productivity analytics.",
      whyLikely: "Clock-out events finalize payable and operational effort signals.",
    },
    "Late Arrival": {
      actions: ["Create Counselling", "Notify Supervisor", "Create Follow-up Task"],
      approvals: ["Supervisor", "Manager"],
      outcome: "Late pattern intervention started and measurable punctuality recovery tracked.",
      whyLikely: "Repeated lateness often indicates planning, transport, or supervision gaps.",
    },
    "Missed Clock": {
      actions: ["Request Supporting Documents", "Notify Employee", "Update Payroll Readiness"],
      approvals: ["Supervisor"],
      outcome: "Clock evidence captured and payroll blocker risk reduced.",
      whyLikely: "Missed clock events can create payroll blockers and audit exposure.",
    },
    "Overtime": {
      actions: ["Schedule Review", "Notify Supervisor", "Recalculate Workforce Intelligence"],
      approvals: ["Manager"],
      outcome: "Overtime root causes identified and overtime leakage trend reduced.",
      whyLikely: "Overtime spikes are commonly caused by coverage and rostering inefficiencies.",
    },
    "Leave Submitted": {
      actions: ["Schedule Review", "Notify Supervisor"],
      approvals: ["Supervisor", "Manager"],
      outcome: "Leave request processed with coverage impact controlled.",
      whyLikely: "Leave submissions can conflict with peak periods and planned coverage.",
    },
    "Leave Approved": {
      actions: ["Recalculate Workforce Intelligence", "Create Follow-up Task"],
      approvals: ["Manager"],
      outcome: "Roster and coverage adjusted after approved leave.",
      whyLikely: "Approved leave changes staffing assumptions and can impact overtime.",
    },
    "Leave Rejected": {
      actions: ["Notify Employee", "Create Follow-up Task"],
      approvals: ["Manager"],
      outcome: "Leave rejection communication and alternative planning completed.",
      whyLikely: "Rejected leave events require guided alternatives to avoid disengagement.",
    },
    "Roster Published": {
      actions: ["Notify Employee", "Recalculate Workforce Intelligence"],
      approvals: ["Manager"],
      outcome: "Published roster acknowledged with readiness recalculated.",
      whyLikely: "Roster release shifts attendance risk posture for the period.",
    },
    "Roster Changed": {
      actions: ["Schedule Review", "Notify Supervisor", "Update Payroll Readiness"],
      approvals: ["Manager"],
      outcome: "Roster variance tracked and payroll impact pre-emptively managed.",
      whyLikely: "Late roster changes can drive avoidable overtime and payroll exceptions.",
    },
    "Payroll Blocked": {
      actions: ["Generate Executive Alert", "Create Follow-up Task", "Notify HR"],
      approvals: ["Owner", "Manager", "HR"],
      outcome: "Blocker resolution workflow opened with accountable owners and deadline.",
      whyLikely: "Payroll blockers usually emerge from unresolved attendance, leave, or exception issues.",
    },
    "HR Case Created": {
      actions: ["Assign Manager", "Schedule Meeting", "Notify HR"],
      approvals: ["HR", "Manager"],
      outcome: "Case workflow progresses with owner, hearing path, and closure checks.",
      whyLikely: "Case creation signals disciplinary or compliance exposure requiring structured follow-through.",
    },
    "Warning Issued": {
      actions: ["Create Follow-up Task", "Schedule Review", "Notify Employee"],
      approvals: ["Manager", "HR"],
      outcome: "Warning follow-up executed and behavior change monitored.",
      whyLikely: "Warnings are effective only when measured with follow-up outcomes.",
    },
    "Document Expired": {
      actions: ["Request Supporting Documents", "Notify Employee", "Notify HR"],
      approvals: ["HR"],
      outcome: "Expired document replaced and compliance exposure closed.",
      whyLikely: "Document expiry introduces audit and legal risk if unresolved.",
    },
    "Training Expired": {
      actions: ["Schedule Meeting", "Create Follow-up Task", "Notify Supervisor"],
      approvals: ["Manager", "HR"],
      outcome: "Training recertification scheduled and completion tracked.",
      whyLikely: "Training expiry can reduce safety, productivity, and compliance readiness.",
    },
    "Certification Expired": {
      actions: ["Request Supporting Documents", "Notify HR", "Generate Executive Alert"],
      approvals: ["HR", "Owner"],
      outcome: "Certification gap contained and legal exposure minimized.",
      whyLikely: "Expired certifications create immediate compliance and operating risk.",
    },
    "Compliance Failure": {
      actions: ["Create HR Case", "Generate Executive Alert", "Create Follow-up Task"],
      approvals: ["HR", "Owner"],
      outcome: "Compliance breach remediated with controlled evidence and owner accountability.",
      whyLikely: "Compliance failures usually point to process non-adherence or missing controls.",
    },
    "Workforce Intelligence Alert": {
      actions: ["Recalculate Workforce Intelligence", "Generate Executive Alert", "Create Follow-up Task"],
      approvals: ["Manager"],
      outcome: "High-risk operational pattern triaged into accountable action.",
      whyLikely: "Intelligence alerts surface patterns with measurable cost and risk implications.",
    },
    "Action Intelligence Alert": {
      actions: ["Create Follow-up Task", "Assign Manager", "Schedule Review"],
      approvals: ["Manager"],
      outcome: "Action insight converted into owned workflow and measurable resolution.",
      whyLikely: "Action alerts represent unresolved recommendations requiring execution ownership.",
    },
  };

  const template = triggerRules[input.trigger];
  const impactEstimate = impactFromEvidence(input.trigger, ev);
  const confidence = clamp(68 + n(ev.signalStrength, 0) * 8 + (input.trigger === "Payroll Blocked" ? 10 : 0));

  const conditions = [
    `Trigger received from ${input.sourceModule}.`,
    `Employee context: ${employeeLabel}.`,
    `Department context: ${department}.`,
  ];

  const businessRules = [
    `Escalate to critical when financial impact exceeds R 5,000.`,
    `Require manager approval for all people-impacting actions.`,
    `Require HR approval for compliance or disciplinary actions.`,
  ];

  const tasks = [
    `Validate evidence for ${input.trigger.toLowerCase()} event.`,
    `Assign owner and target completion date.`,
    `Capture before-and-after KPI values for outcome verification.`,
  ];

  const notifications = [
    "In-app owner notification",
    "Email escalation if overdue",
    "WhatsApp update when configured",
  ];

  return {
    workflowTitle: `${input.trigger} - ${employeeLabel}`,
    trigger: input.trigger,
    conditions,
    businessRules,
    recommendedActions: template.actions,
    approvalsRequired: template.approvals,
    notifications,
    tasks,
    owner,
    expectedOutcome: template.outcome,
    beforeMetrics: {
      payrollBlockers: n(ev.payrollBlockers),
      overtimeHours: n(ev.overtimeHours),
      lateArrivals: n(ev.lateArrivals),
      complianceBreaches: n(ev.complianceBreaches),
    },
    impactEstimate,
    whyLikely: template.whyLikely,
    confidence,
    consequencesIfIgnored:
      "Operational drift increases, recurring issues compound, and business cost/risk rises across payroll, compliance, and workforce stability.",
    autoPreparationSummary:
      "System can pre-build owner assignment, approval chain, notifications, and follow-up tasks from this trigger.",
    stage: "Triggered",
  };
}
