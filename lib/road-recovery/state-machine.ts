/**
 * VYRON CORE — Road & Recovery state machine (Phase 0).
 *
 * PURE MODULE. No Supabase, no fetch, no environment, no clock reads beyond what the
 * caller supplies. Every function is a total function of its arguments, which is what
 * makes the whole vertical's most safety-critical logic unit-testable.
 *
 * ---------------------------------------------------------------------------
 * THE TWO-LEVEL STATUS MODEL (load-bearing — do not collapse it)
 * ---------------------------------------------------------------------------
 *
 *   public.field_jobs.status          coarse PHYSICAL status. 6 values. UNCHANGED.
 *   public.rr_service_jobs.service_state  fine-grained Road & Recovery workflow state.
 *
 * field_jobs.status keeps its existing CHECK constraint and its existing six values
 * because three shipped engines hard-code the "open job" set against them:
 *
 *   lib/payroll-intelligence.ts   ~line 730
 *   lib/workforce-ai-copilot.ts   ~line 466
 *   lib/workforce-digital-twin.ts ~line 269
 *
 * all of which test `["Pending", "Dispatched", "Travelling", "On Site"]`. Widening the
 * CHECK would let recovery-specific states leak into payroll readiness, the copilot and
 * the digital twin, where they would be silently mis-bucketed. So the detailed ladder
 * lives in rr_service_jobs.service_state, and every workflow state declares the
 * physical status it maps down to. physicalStatusFor() is that mapping, and it is the
 * only sanctioned way to derive field_jobs.status from a Road & Recovery state.
 *
 * ---------------------------------------------------------------------------
 * BYSTAND
 * ---------------------------------------------------------------------------
 *
 * The bystand workflow is defined here in full and shares no state with either towing
 * workflow. It has no loading, securing, transit, destination, offload, handover-to-
 * receiver or storage state, because a bystand attendance does none of those things.
 * Its billable clock runs in `standing_by`, not from dispatch. If a recovery becomes
 * necessary, `convert_to_recovery` is flagged spawnsLinkedJob: the caller creates a
 * SEPARATE recovery job, and this job continues to its own close and its own invoice.
 * assertBystandStateMachineIndependence() enforces all of that.
 */

// Type-only import: erased at runtime, so this module stays free of the Supabase client
// graph that lib/field-operations pulls in, while remaining bound to the real union.
import type { FieldJobStatus } from "@/lib/field-operations";
import { RR_WORKFLOW_KEYS, type RrWorkflowKey } from "@/lib/road-recovery/service-types";
// The scope vocabulary is owned by the Phase 3 requirements engine and is imported
// rather than restated, so the two can never drift.
import type { RrBlockingScope } from "@/lib/road-recovery/requirements";

/** The coarse physical statuses. Mirrors FIELD_JOB_STATUSES in lib/field-operations.ts. */
export const RR_PHYSICAL_STATUSES = [
  "Pending",
  "Dispatched",
  "Travelling",
  "On Site",
  "Completed",
  "Cancelled",
] as const satisfies readonly FieldJobStatus[];

export type RrPhysicalStatus = FieldJobStatus;

export type RrStateKind = "active" | "paused" | "terminal";

/**
 * Guard keys. A transition names the preconditions it needs; the caller supplies a
 * context of booleans. Unknown or missing guard values are treated as UNSATISFIED
 * (fail closed) so a caller that forgets to supply context cannot advance a job.
 *
 * Phase 0 only wires `authorisation_valid` / `authorisation_not_required`. The rest are
 * declared so the graph is honest about what will gate it; Phases 3-5 populate them.
 */
export const RR_GUARDS = [
  "authorisation_valid",
  "authorisation_not_required",
  "evidence_complete",
  "release_authorised",
  "disposal_authorised",
] as const;

export type RrGuard = (typeof RR_GUARDS)[number];

/**
 * Semantic roles a state can fulfil.
 *
 * This is what makes the service layer workflow-agnostic. Phase 1 hardcoded tow state
 * names ("on_scene", "dispatch_pending"), which silently broke every workflow that names
 * those moments differently — BYSTAND arrives at `arrived_on_scene` and returns a
 * declined offer to `authorised`, not `dispatch_pending`.
 *
 * Code now asks for the ROLE and the workflow answers with its own state name, so one
 * implementation serves tow recovery, heavy recovery, roadside assistance, BYSTAND,
 * vehicle movement and storage with no service-specific branching.
 */
export const RR_STATE_ROLES = [
  /** Where a dispatch offer places the job. */
  "offer",
  /** Where driver acceptance places the job. */
  "accept",
  /** Where departure to the scene places the job. */
  "travel",
  /** Where GPS-verified arrival places the job. */
  "arrival",
  /** Where a declined or withdrawn offer returns the job. */
  "dispatch_pool",
  /** The single billable standing-time state (BYSTAND only). */
  "standing",
] as const;

export type RrStateRole = (typeof RR_STATE_ROLES)[number];

export type RrStateDefinition = {
  state: string;
  kind: RrStateKind;
  physicalStatus: RrPhysicalStatus;
  /** True for the single state in which standing time accrues (BYSTAND only). */
  billableStandingClock?: boolean;
  /** Semantic roles this state fulfils. At most one state per role per workflow. */
  roles?: readonly RrStateRole[];
  description?: string;
};

export type RrTransitionDefinition = {
  code: string;
  /** "*" means "every non-terminal state", expanded when the definition is compiled. */
  from: string;
  to: string;
  guards?: readonly RrGuard[];
  /** Caller must create a separate linked job (BYSTAND conversion, roadside escalation). */
  spawnsLinkedJob?: boolean;
  /** A reason string is mandatory for this transition. */
  requiresReason?: boolean;
  /**
   * Which compliance scope the `evidence_complete` guard is evaluated at, when this
   * transition declares it.
   *
   * Declared HERE, as workflow data, so the service layer never has to know that
   * `checked_out -> released` belongs to storage. Requirements carry blocking scopes
   * (Phase 3) and a transition says which scope it gates; the resolver reads both, and no
   * state name is ever hardcoded in generic job logic.
   *
   * Omitted means "invoice", which is what every Phase 0-3 transition using this guard
   * was already gating.
   *
   * NOT serialised into the seeded workflow JSON — workflowDefinitionSeedJson() whitelists
   * the fields the database reads, exactly as it already does for state roles. Adding it
   * therefore cannot break sql/070 seed parity.
   */
  complianceScope?: RrBlockingScope;
};

export type RrWorkflowDefinition = {
  workflowKey: RrWorkflowKey;
  version: number;
  initialState: string;
  /**
   * The state a job is CREATED in through the service layer.
   *
   * Not always the initial state. A job captured through the API has, by the act of being
   * captured, already been logged — so the tow-shaped workflows start at `logged` and
   * their `draft` step exists only for a job typed in and not yet accepted.
   *
   * Declared per workflow because the answer genuinely differs: a storage job begins at
   * `storage_pending`, and advancing it one step on creation would claim the vehicle was
   * already checked in.
   *
   * Omitted means initialState. NOT serialised into the seeded workflow JSON —
   * workflowDefinitionSeedJson() whitelists what the database reads — so adding it cannot
   * break sql/070 seed parity.
   */
  creationState?: string;
  states: readonly RrStateDefinition[];
  transitions: readonly RrTransitionDefinition[];
};

export type RrTransitionContext = Partial<Record<RrGuard, boolean>>;

export type RrTransitionCheck =
  | { allowed: true; transition: RrTransitionDefinition }
  | {
      allowed: false;
      reason:
        | "unknown_workflow"
        | "unknown_from_state"
        | "unknown_to_state"
        | "terminal_state"
        | "no_such_transition"
        | "guard_unsatisfied"
        | "reason_required";
      message: string;
      unsatisfiedGuards?: RrGuard[];
    };

/** The row the caller persists to public.rr_service_state_events. Built, never written. */
export type RrStateTransitionEvent = {
  workflowKey: RrWorkflowKey;
  workflowVersion: number;
  transitionCode: string;
  fromState: string;
  toState: string;
  physicalStatusBefore: RrPhysicalStatus;
  physicalStatusAfter: RrPhysicalStatus;
  occurredAt: string;
  secondsInPreviousState: number | null;
  reason: string | null;
  spawnsLinkedJob: boolean;
  entersBillableStandingClock: boolean;
  leavesBillableStandingClock: boolean;
};

export type RrApplyTransitionResult =
  | { ok: true; state: string; physicalStatus: RrPhysicalStatus; event: RrStateTransitionEvent }
  | { ok: false; check: Extract<RrTransitionCheck, { allowed: false }> };

// ---------------------------------------------------------------------------
// Definition helpers
// ---------------------------------------------------------------------------

function state(
  name: string,
  physicalStatus: RrPhysicalStatus,
  kind: RrStateKind = "active",
  extra: Omit<RrStateDefinition, "state" | "physicalStatus" | "kind"> = {}
): RrStateDefinition {
  return { state: name, kind, physicalStatus, ...extra };
}

function step(
  code: string,
  from: string,
  to: string,
  extra: Omit<RrTransitionDefinition, "code" | "from" | "to"> = {}
): RrTransitionDefinition {
  return { code, from, to, ...extra };
}

/** Cancellation is available from any non-terminal state and always needs a reason. */
const UNIVERSAL_CANCEL: RrTransitionDefinition = {
  code: "cancel",
  from: "*",
  to: "cancelled",
  requiresReason: true,
};

/** Intake states shared by every workflow that is dispatched to a scene. */
const INTAKE_STATES: readonly RrStateDefinition[] = [
  state("draft", "Pending", "active", { description: "Captured but not yet logged." }),
  state("logged", "Pending", "active", { description: "Accepted into the operation." }),
  state("authorisation_pending", "Pending"),
  state("authorised", "Pending"),
  state("dispatch_pending", "Pending", "active", { roles: ["dispatch_pool"] }),
  state("assigned", "Dispatched", "active", { roles: ["offer"] }),
  state("accepted", "Dispatched", "active", { roles: ["accept"] }),
];

const INTAKE_TRANSITIONS: readonly RrTransitionDefinition[] = [
  step("log", "draft", "logged"),
  step("request_authorisation", "logged", "authorisation_pending"),
  step("skip_authorisation", "logged", "dispatch_pending", {
    guards: ["authorisation_not_required"],
  }),
  step("authorise", "authorisation_pending", "authorised"),
  step("decline", "authorisation_pending", "declined", { requiresReason: true }),
  step("release_to_dispatch", "authorised", "dispatch_pending", {
    guards: ["authorisation_valid"],
  }),
  step("assign", "dispatch_pending", "assigned"),
  step("unassign", "assigned", "dispatch_pending", { requiresReason: true }),
  step("accept", "assigned", "accepted"),
];

/**
 * Close-out states shared by the dispatched workflows.
 *
 * `declined` and `no_show` are deliberately NOT terminal. Both are operational outcomes
 * that a controller still has to dispose of, and a refused or unattended job is
 * frequently still billable as an abortive callout. Making them terminal would strand
 * them with no lawful way to close. Phase 6 adds the abortive-billing path; Phase 0 only
 * guarantees they can always be closed out.
 */
const CLOSE_OUT_STATES: readonly RrStateDefinition[] = [
  state("evidence_complete", "On Site"),
  state("invoice_ready", "Completed"),
  state("invoiced", "Completed"),
  state("closed", "Completed", "terminal"),
  state("cancelled", "Cancelled", "terminal"),
  state("declined", "Cancelled", "active", {
    description: "Authorisation refused. Must still be closed out by a controller.",
  }),
  state("no_show", "Cancelled", "active", {
    description: "Nothing to attend on arrival. Must still be closed out by a controller.",
  }),
];

const CLOSE_OUT_TRANSITIONS: readonly RrTransitionDefinition[] = [
  step("ready_to_invoice", "evidence_complete", "invoice_ready", { guards: ["evidence_complete"] }),
  step("issue_invoice", "invoice_ready", "invoiced"),
  step("close", "invoiced", "closed"),
  step("cancel_after_decline", "declined", "cancelled", { requiresReason: true }),
  step("close_no_show", "no_show", "cancelled", { requiresReason: true }),
  UNIVERSAL_CANCEL,
];

// ---------------------------------------------------------------------------
// Workflow: tow_recovery  (accident_recovery, tow_in)
// ---------------------------------------------------------------------------

const TOW_RECOVERY: RrWorkflowDefinition = {
  workflowKey: "tow_recovery",
  version: 1,
  initialState: "draft",
  creationState: "logged",
  states: [
    ...INTAKE_STATES,
    state("en_route", "Travelling", "active", { roles: ["travel"] }),
    state("on_scene", "On Site", "active", { roles: ["arrival"] }),
    state("assessing", "On Site"),
    state("loading", "On Site"),
    state("secured", "On Site"),
    state("departing_scene", "On Site"),
    state("in_transit", "Travelling"),
    state("arrived_destination", "On Site"),
    state("offloading", "On Site"),
    state("storage_in", "On Site", "active", {
      description: "Handed into the storage sub-workflow instead of a third party.",
    }),
    state("handover_pending", "On Site"),
    state("handed_over", "On Site"),
    state("paperwork_complete", "On Site"),
    ...CLOSE_OUT_STATES,
  ],
  transitions: [
    ...INTAKE_TRANSITIONS,
    step("depart", "accepted", "en_route"),
    step("arrive_scene", "en_route", "on_scene"),
    step("record_no_show", "en_route", "no_show", { requiresReason: true }),
    step("begin_assessment", "on_scene", "assessing"),
    step("begin_loading", "assessing", "loading"),
    step("secure_load", "loading", "secured"),
    step("clear_scene", "secured", "departing_scene"),
    step("begin_transit", "departing_scene", "in_transit"),
    step("arrive_destination", "in_transit", "arrived_destination"),
    step("begin_offload", "arrived_destination", "offloading"),
    step("route_to_storage", "arrived_destination", "storage_in"),
    step("ready_for_handover", "offloading", "handover_pending"),
    step("complete_handover", "handover_pending", "handed_over"),
    step("storage_accepted", "storage_in", "handed_over"),
    step("complete_paperwork", "handed_over", "paperwork_complete"),
    step("verify_evidence", "paperwork_complete", "evidence_complete"),
    ...CLOSE_OUT_TRANSITIONS,
  ],
};

// ---------------------------------------------------------------------------
// Workflow: heavy_recovery
// ---------------------------------------------------------------------------

const HEAVY_RECOVERY: RrWorkflowDefinition = {
  workflowKey: "heavy_recovery",
  version: 1,
  initialState: "draft",
  creationState: "logged",
  states: [
    ...INTAKE_STATES,
    state("en_route", "Travelling", "active", { roles: ["travel"] }),
    state("on_scene", "On Site", "active", { roles: ["arrival"] }),
    state("scene_assessment", "On Site"),
    state("recovery_plan_pending", "On Site"),
    state("recovery_plan_approved", "On Site", "active", {
      description: "Second authorisation: the recovery plan and its cost ceiling.",
    }),
    state("additional_resources_requested", "On Site", "paused"),
    state("rigging", "On Site"),
    state("recovery_in_progress", "On Site"),
    state("uprighted", "On Site"),
    state("load_secured", "On Site"),
    state("scene_cleared", "On Site"),
    state("in_transit", "Travelling"),
    state("arrived_destination", "On Site"),
    state("offloading", "On Site"),
    state("storage_in", "On Site"),
    state("handover_pending", "On Site"),
    state("handed_over", "On Site"),
    state("paperwork_complete", "On Site"),
    ...CLOSE_OUT_STATES,
  ],
  transitions: [
    ...INTAKE_TRANSITIONS,
    step("depart", "accepted", "en_route"),
    step("arrive_scene", "en_route", "on_scene"),
    step("record_no_show", "en_route", "no_show", { requiresReason: true }),
    step("begin_scene_assessment", "on_scene", "scene_assessment"),
    step("submit_recovery_plan", "scene_assessment", "recovery_plan_pending"),
    step("approve_recovery_plan", "recovery_plan_pending", "recovery_plan_approved", {
      guards: ["authorisation_valid"],
    }),
    step("request_additional_resources", "recovery_plan_approved", "additional_resources_requested", {
      requiresReason: true,
    }),
    step("resources_on_scene", "additional_resources_requested", "recovery_plan_approved"),
    step("begin_rigging", "recovery_plan_approved", "rigging"),
    step("begin_recovery", "rigging", "recovery_in_progress"),
    step("upright_vehicle", "recovery_in_progress", "uprighted"),
    step("secure_load", "uprighted", "load_secured"),
    step("clear_scene", "load_secured", "scene_cleared"),
    step("begin_transit", "scene_cleared", "in_transit"),
    step("arrive_destination", "in_transit", "arrived_destination"),
    step("begin_offload", "arrived_destination", "offloading"),
    step("route_to_storage", "arrived_destination", "storage_in"),
    step("ready_for_handover", "offloading", "handover_pending"),
    step("complete_handover", "handover_pending", "handed_over"),
    step("storage_accepted", "storage_in", "handed_over"),
    step("complete_paperwork", "handed_over", "paperwork_complete"),
    step("verify_evidence", "paperwork_complete", "evidence_complete"),
    ...CLOSE_OUT_TRANSITIONS,
  ],
};

// ---------------------------------------------------------------------------
// Workflow: roadside_assist  (jump_start, roadside_assistance)
// No custody, no destination, no transit leg.
// ---------------------------------------------------------------------------

const ROADSIDE_ASSIST: RrWorkflowDefinition = {
  workflowKey: "roadside_assist",
  version: 1,
  initialState: "draft",
  creationState: "logged",
  states: [
    ...INTAKE_STATES,
    state("en_route", "Travelling", "active", { roles: ["travel"] }),
    state("on_scene", "On Site", "active", { roles: ["arrival"] }),
    state("diagnosing", "On Site"),
    state("service_in_progress", "On Site"),
    state("resolved_on_scene", "On Site"),
    state("customer_signed_off", "On Site"),
    state("unresolved", "On Site"),
    state("escalated_to_tow", "On Site", "active", {
      description:
        "A separate linked recovery job is raised. This job still bills its own callout and closes on its own terms.",
    }),
    ...CLOSE_OUT_STATES,
  ],
  transitions: [
    ...INTAKE_TRANSITIONS,
    step("depart", "accepted", "en_route"),
    step("arrive_scene", "en_route", "on_scene"),
    step("record_no_show", "en_route", "no_show", { requiresReason: true }),
    step("begin_diagnosis", "on_scene", "diagnosing"),
    step("begin_service", "diagnosing", "service_in_progress"),
    step("resolve_on_scene", "service_in_progress", "resolved_on_scene"),
    step("record_unresolved", "service_in_progress", "unresolved", { requiresReason: true }),
    step("escalate_to_tow", "unresolved", "escalated_to_tow", {
      spawnsLinkedJob: true,
      requiresReason: true,
    }),
    step("customer_sign_off", "resolved_on_scene", "customer_signed_off"),
    step("verify_evidence", "customer_signed_off", "evidence_complete"),
    step("verify_evidence_after_escalation", "escalated_to_tow", "evidence_complete"),
    ...CLOSE_OUT_TRANSITIONS,
  ],
};

// ---------------------------------------------------------------------------
// Workflow: bystand  — STRUCTURALLY INDEPENDENT OF TOWING
//
// Deliberately absent: loading, securing, in_transit, arrived_destination, offloading,
// storage_in, handover_pending, handed_over. A bystand attendance moves no vehicle and
// takes custody of nothing. `standing_by` is the one billable-clock state.
// ---------------------------------------------------------------------------

const BYSTAND_V1: RrWorkflowDefinition = {
  workflowKey: "bystand",
  version: 1,
  initialState: "draft",
  creationState: "logged",
  states: [
    state("draft", "Pending"),
    state("logged", "Pending"),
    state("bystand_requested", "Pending", "active", {
      description: "A bystand attendance specifically has been requested.",
    }),
    state("authorisation_pending", "Pending"),
    state("authorised", "Pending", "active", { roles: ["dispatch_pool"] }),
    state("assigned", "Dispatched", "active", { roles: ["offer"] }),
    state("accepted", "Dispatched", "active", { roles: ["accept"] }),
    state("en_route", "Travelling", "active", { roles: ["travel"] }),
    state("arrived_on_scene", "On Site", "active", { roles: ["arrival"] }),
    state("standing_by", "On Site", "active", {
      billableStandingClock: true,
      roles: ["standing"],
      description: "Billable standing time accrues here and nowhere else.",
    }),
    state("scene_handover_to_authority", "On Site", "paused", {
      description: "Scene under authority control; standing clock paused.",
    }),
    state("weather_hold", "On Site", "paused"),
    state("converted_to_recovery", "On Site", "active", {
      description:
        "A SEPARATE linked recovery job has been raised. This bystand job bills its own standing time and closes on its own terms.",
    }),
    state("stand_down_requested", "On Site"),
    state("stood_down", "On Site"),
    state("departed_scene", "On Site"),
    state("report_submitted", "On Site"),
    state("evidence_complete", "On Site"),
    state("invoice_ready", "Completed"),
    state("invoiced", "Completed"),
    state("closed", "Completed", "terminal"),
    state("cancelled", "Cancelled", "terminal"),
    state("declined", "Cancelled", "active"),
    state("no_show", "Cancelled", "active"),
  ],
  transitions: [
    step("log", "draft", "logged"),
    step("request_bystand", "logged", "bystand_requested"),
    step("request_authorisation", "bystand_requested", "authorisation_pending"),
    step("authorise", "authorisation_pending", "authorised"),
    step("decline", "authorisation_pending", "declined", { requiresReason: true }),
    step("assign", "authorised", "assigned", { guards: ["authorisation_valid"] }),
    step("unassign", "assigned", "authorised", { requiresReason: true }),
    step("accept", "assigned", "accepted"),
    step("depart", "accepted", "en_route"),
    step("arrive_scene", "en_route", "arrived_on_scene"),
    step("record_no_show", "en_route", "no_show", { requiresReason: true }),
    // The billable standing clock starts here, not at dispatch.
    step("begin_standing_by", "arrived_on_scene", "standing_by"),
    step("hand_scene_to_authority", "standing_by", "scene_handover_to_authority", {
      requiresReason: true,
    }),
    step("resume_from_authority", "scene_handover_to_authority", "standing_by"),
    step("weather_hold", "standing_by", "weather_hold", { requiresReason: true }),
    step("resume_from_weather", "weather_hold", "standing_by"),
    step("convert_to_recovery", "standing_by", "converted_to_recovery", {
      spawnsLinkedJob: true,
      requiresReason: true,
    }),
    step("request_stand_down", "standing_by", "stand_down_requested"),
    step("request_stand_down_after_conversion", "converted_to_recovery", "stand_down_requested"),
    step("stand_down", "stand_down_requested", "stood_down"),
    step("depart_scene", "stood_down", "departed_scene"),
    step("submit_report", "departed_scene", "report_submitted"),
    step("verify_evidence", "report_submitted", "evidence_complete"),
    step("ready_to_invoice", "evidence_complete", "invoice_ready", { guards: ["evidence_complete"] }),
    step("issue_invoice", "invoice_ready", "invoiced"),
    step("close", "invoiced", "closed"),
    step("cancel_after_decline", "declined", "cancelled", { requiresReason: true }),
    step("close_no_show", "no_show", "cancelled", { requiresReason: true }),
    UNIVERSAL_CANCEL,
  ],
};

/**
 * BYSTAND workflow VERSION 2 (Phase 2).
 *
 * Version 1 above is left byte-for-byte intact: jobs created under it keep running it,
 * which is exactly what rr_workflow_definitions' (company_id, workflow_key, version)
 * versioning was built for in Phase 0.
 *
 * v2 closes two operational gaps found in the Phase 2 inspection. In v1 a crew that was
 * PAUSED — scene under authority control, or on a weather hold — could not be stood down
 * or converted without first resuming `standing_by`, which would restart the billable
 * standing clock for no operational reason and overbill the counterparty.
 *
 * v2 therefore allows, directly from either paused state:
 *   - stand-down request  (the controller releases a paused crew)
 *   - conversion to recovery (a separate linked recovery job is raised)
 *
 * Nothing else changes: the same states, the same single billable standing state, the
 * same structural separation from towing.
 */
const BYSTAND_V2: RrWorkflowDefinition = {
  ...BYSTAND_V1,
  version: 2,
  transitions: [
    ...BYSTAND_V1.transitions,

    // Stand a paused crew down without resuming billable standing time first.
    step("request_stand_down_from_authority_hold", "scene_handover_to_authority", "stand_down_requested"),
    step("request_stand_down_from_weather_hold", "weather_hold", "stand_down_requested"),

    // A recovery need can become clear while the scene is still held. Conversion from a
    // paused state spawns the SEPARATE linked recovery job exactly as it does from
    // standing_by, and still does not turn this job into a tow.
    step("convert_to_recovery_from_authority_hold", "scene_handover_to_authority", "converted_to_recovery", {
      spawnsLinkedJob: true,
      requiresReason: true,
    }),
    step("convert_to_recovery_from_weather_hold", "weather_hold", "converted_to_recovery", {
      spawnsLinkedJob: true,
      requiresReason: true,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Workflow: vehicle_movement  — two condition inspections, no incident
// ---------------------------------------------------------------------------

const VEHICLE_MOVEMENT: RrWorkflowDefinition = {
  workflowKey: "vehicle_movement",
  version: 1,
  initialState: "draft",
  creationState: "logged",
  states: [
    state("draft", "Pending"),
    state("logged", "Pending"),
    state("collection_scheduled", "Pending", "active", { roles: ["dispatch_pool"] }),
    state("assigned", "Dispatched", "active", { roles: ["offer"] }),
    state("accepted", "Dispatched", "active", { roles: ["accept"] }),
    state("en_route_collection", "Travelling", "active", { roles: ["travel"] }),
    state("at_collection", "On Site", "active", { roles: ["arrival"] }),
    state("pre_move_inspection", "On Site"),
    state("collected", "On Site"),
    state("in_transit", "Travelling"),
    state("at_delivery", "On Site"),
    state("post_move_inspection", "On Site"),
    state("delivered", "On Site"),
    state("handover_signed", "On Site"),
    state("evidence_complete", "On Site"),
    state("invoice_ready", "Completed"),
    state("invoiced", "Completed"),
    state("closed", "Completed", "terminal"),
    state("cancelled", "Cancelled", "terminal"),
    state("no_show", "Cancelled", "active"),
  ],
  transitions: [
    step("log", "draft", "logged"),
    step("schedule_collection", "logged", "collection_scheduled"),
    step("assign", "collection_scheduled", "assigned"),
    step("unassign", "assigned", "collection_scheduled", { requiresReason: true }),
    step("accept", "assigned", "accepted"),
    step("depart_for_collection", "accepted", "en_route_collection"),
    step("arrive_collection", "en_route_collection", "at_collection"),
    step("record_no_show", "en_route_collection", "no_show", { requiresReason: true }),
    step("begin_pre_move_inspection", "at_collection", "pre_move_inspection"),
    step("collect_vehicle", "pre_move_inspection", "collected"),
    step("begin_transit", "collected", "in_transit"),
    step("arrive_delivery", "in_transit", "at_delivery"),
    step("begin_post_move_inspection", "at_delivery", "post_move_inspection"),
    step("deliver_vehicle", "post_move_inspection", "delivered"),
    step("sign_handover", "delivered", "handover_signed"),
    step("verify_evidence", "handover_signed", "evidence_complete"),
    step("ready_to_invoice", "evidence_complete", "invoice_ready", { guards: ["evidence_complete"] }),
    step("issue_invoice", "invoice_ready", "invoiced"),
    step("close", "invoiced", "closed"),
    step("close_no_show", "no_show", "cancelled", { requiresReason: true }),
    UNIVERSAL_CANCEL,
  ],
};

// ---------------------------------------------------------------------------
// Workflow: storage  — custodial sub-workflow
// ---------------------------------------------------------------------------

const STORAGE: RrWorkflowDefinition = {
  workflowKey: "storage",
  version: 1,
  initialState: "storage_pending",
  states: [
    state("storage_pending", "Pending"),
    state("checked_in", "On Site"),
    state("stored", "On Site", "active", { description: "Daily storage accrual runs here." }),
    state("release_requested", "On Site"),
    state("release_authorisation_pending", "On Site"),
    state("release_authorised", "On Site"),
    state("checked_out", "On Site"),
    state("released", "Completed", "terminal"),
    state("unclaimed", "On Site"),
    state("disposal_notice_issued", "On Site"),
    state("disposal_authorised", "On Site"),
    state("disposed", "Completed", "terminal"),
    state("cancelled", "Cancelled", "terminal"),
  ],
  transitions: [
    step("check_in", "storage_pending", "checked_in"),
    step("begin_storage", "checked_in", "stored"),
    step("request_release", "stored", "release_requested"),
    step("request_release_authorisation", "release_requested", "release_authorisation_pending"),
    step("authorise_release", "release_authorisation_pending", "release_authorised", {
      guards: ["release_authorised"],
    }),
    step("check_out", "release_authorised", "checked_out"),
    // Gated at the RELEASE scope, not the invoice scope: what must be in hand before a
    // vehicle leaves the yard is release evidence, which Phase 3's requirement catalogue
    // already declares with blockingScopes ["release"].
    step("release", "checked_out", "released", {
      guards: ["evidence_complete"],
      complianceScope: "release",
    }),
    step("mark_unclaimed", "stored", "unclaimed", { requiresReason: true }),
    step("issue_disposal_notice", "unclaimed", "disposal_notice_issued"),
    step("authorise_disposal", "disposal_notice_issued", "disposal_authorised", {
      guards: ["disposal_authorised"],
    }),
    step("dispose", "disposal_authorised", "disposed", { requiresReason: true }),
    UNIVERSAL_CANCEL,
  ],
};

// ---------------------------------------------------------------------------
// Registry + compilation
// ---------------------------------------------------------------------------

/**
 * EVERY published version of every workflow, oldest first.
 *
 * Historical jobs keep the graph they actually ran under, so a workflow change can never
 * retroactively legalise or forbid a transition on a job already in flight.
 */
export const RR_WORKFLOW_VERSIONS: Readonly<Record<RrWorkflowKey, readonly RrWorkflowDefinition[]>> =
  {
    tow_recovery: [TOW_RECOVERY],
    heavy_recovery: [HEAVY_RECOVERY],
    roadside_assist: [ROADSIDE_ASSIST],
    bystand: [BYSTAND_V1, BYSTAND_V2],
    vehicle_movement: [VEHICLE_MOVEMENT],
    storage: [STORAGE],
  };

/** The ACTIVE (highest) version of each workflow. New jobs are created against these. */
export const RR_WORKFLOW_DEFINITIONS: Readonly<Record<RrWorkflowKey, RrWorkflowDefinition>> =
  Object.fromEntries(
    RR_WORKFLOW_KEYS.map((key) => {
      const versions = RR_WORKFLOW_VERSIONS[key];
      const active = versions.reduce((best, entry) => (entry.version > best.version ? entry : best));
      return [key, active];
    })
  ) as Record<RrWorkflowKey, RrWorkflowDefinition>;

/** The active version number for a workflow, for callers creating a new job. */
export function activeWorkflowVersion(workflowKey: RrWorkflowKey): number {
  return RR_WORKFLOW_DEFINITIONS[workflowKey].version;
}

type CompiledWorkflow = {
  definition: RrWorkflowDefinition;
  statesByName: Map<string, RrStateDefinition>;
  /** from -> to -> transition. "*" transitions are expanded across non-terminal states. */
  transitionsByFrom: Map<string, Map<string, RrTransitionDefinition>>;
};

function compile(definition: RrWorkflowDefinition): CompiledWorkflow {
  const statesByName = new Map<string, RrStateDefinition>();
  for (const entry of definition.states) {
    if (statesByName.has(entry.state)) {
      throw new Error(
        `Workflow "${definition.workflowKey}" declares duplicate state "${entry.state}".`
      );
    }
    statesByName.set(entry.state, entry);
  }

  const transitionsByFrom = new Map<string, Map<string, RrTransitionDefinition>>();

  const register = (from: string, transition: RrTransitionDefinition) => {
    let bucket = transitionsByFrom.get(from);
    if (!bucket) {
      bucket = new Map<string, RrTransitionDefinition>();
      transitionsByFrom.set(from, bucket);
    }
    // An explicit transition always wins over an expanded wildcard.
    if (!bucket.has(transition.to) || transition.from !== "*") {
      bucket.set(transition.to, transition);
    }
  };

  // Explicit transitions first, so wildcards never mask a declared edge.
  for (const transition of definition.transitions) {
    if (transition.from === "*") continue;
    register(transition.from, transition);
  }

  for (const transition of definition.transitions) {
    if (transition.from !== "*") continue;
    for (const entry of definition.states) {
      if (entry.kind === "terminal") continue;
      if (entry.state === transition.to) continue;
      const bucket = transitionsByFrom.get(entry.state);
      if (bucket?.has(transition.to)) continue;
      register(entry.state, { ...transition, from: entry.state });
    }
  }

  return { definition, statesByName, transitionsByFrom };
}

const COMPILED: Record<string, CompiledWorkflow> = (() => {
  const out: Record<string, CompiledWorkflow> = {};
  for (const key of RR_WORKFLOW_KEYS) {
    for (const definition of RR_WORKFLOW_VERSIONS[key]) {
      out[`${key}@${definition.version}`] = compile(definition);
    }
    // The bare key resolves to the ACTIVE version, so every existing caller that does not
    // care about versioning keeps working unchanged.
    out[key] = compile(RR_WORKFLOW_DEFINITIONS[key]);
  }
  return out;
})();

/**
 * Resolves the compiled graph for a workflow at a specific version.
 *
 * An unknown version falls back to nothing rather than to the active graph: silently
 * running a job on a different graph than it was created under is precisely the failure
 * versioning exists to prevent.
 */
function compiledFor(workflowKey: unknown, version?: number | null): CompiledWorkflow | undefined {
  const key = String(workflowKey ?? "");
  if (version === undefined || version === null) return COMPILED[key];
  return COMPILED[`${key}@${version}`];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getWorkflowDefinition(
  workflowKey: unknown,
  version?: number | null
): RrWorkflowDefinition | null {
  const compiled = compiledFor(workflowKey, version);
  return compiled ? compiled.definition : null;
}

export function initialStateFor(workflowKey: RrWorkflowKey): string {
  return RR_WORKFLOW_DEFINITIONS[workflowKey].initialState;
}

export function workflowStates(workflowKey: RrWorkflowKey): string[] {
  return RR_WORKFLOW_DEFINITIONS[workflowKey].states.map((entry) => entry.state);
}

export function isKnownState(
  workflowKey: unknown,
  stateName: unknown,
  version?: number | null
): boolean {
  return Boolean(compiledFor(workflowKey, version)?.statesByName.has(String(stateName ?? "")));
}

export function isTerminalState(
  workflowKey: unknown,
  stateName: unknown,
  version?: number | null
): boolean {
  return compiledFor(workflowKey, version)?.statesByName.get(String(stateName ?? ""))?.kind === "terminal";
}

export function terminalStates(workflowKey: RrWorkflowKey): string[] {
  return RR_WORKFLOW_DEFINITIONS[workflowKey].states
    .filter((entry) => entry.kind === "terminal")
    .map((entry) => entry.state);
}

/**
 * The two-level status bridge: the coarse field_jobs.status a workflow state maps down
 * to. Returns null for an unknown workflow/state rather than guessing, so a caller can
 * never silently write a wrong physical status.
 */
export function physicalStatusFor(
  workflowKey: unknown,
  stateName: unknown,
  version?: number | null
): RrPhysicalStatus | null {
  return (
    compiledFor(workflowKey, version)?.statesByName.get(String(stateName ?? ""))?.physicalStatus ??
    null
  );
}

/**
 * The state that fulfils a semantic role in this workflow, or null if it has none.
 *
 * This is the seam that keeps the service layer free of service-specific branching:
 * `stateForRole("bystand", "arrival")` answers `arrived_on_scene` while
 * `stateForRole("tow_recovery", "arrival")` answers `on_scene`, and the caller never
 * needs to know which service it is handling.
 */
export function stateForRole(
  workflowKey: unknown,
  role: RrStateRole,
  version?: number | null
): string | null {
  const compiled = compiledFor(workflowKey, version);
  if (!compiled) return null;
  const match = compiled.definition.states.find((entry) => (entry.roles ?? []).includes(role));
  return match ? match.state : null;
}

/** Every role declared by a workflow, for validation and diagnostics. */
export function rolesForWorkflow(
  workflowKey: unknown,
  version?: number | null
): Partial<Record<RrStateRole, string>> {
  const compiled = compiledFor(workflowKey, version);
  if (!compiled) return {};
  const out: Partial<Record<RrStateRole, string>> = {};
  for (const entry of compiled.definition.states) {
    for (const role of entry.roles ?? []) {
      if (out[role] === undefined) out[role] = entry.state;
    }
  }
  return out;
}

/** True only for the state in which billable standing time accrues (BYSTAND). */
export function isBillableStandingState(
  workflowKey: unknown,
  stateName: unknown,
  version?: number | null
): boolean {
  return (
    compiledFor(workflowKey, version)?.statesByName.get(String(stateName ?? ""))
      ?.billableStandingClock === true
  );
}

/** Every state reachable from `stateName` in one transition, with its transition code. */
export function availableTransitions(
  workflowKey: unknown,
  stateName: unknown,
  version?: number | null
): RrTransitionDefinition[] {
  const compiled = compiledFor(workflowKey, version);
  if (!compiled) return [];
  const bucket = compiled.transitionsByFrom.get(String(stateName ?? ""));
  if (!bucket) return [];
  return [...bucket.values()];
}

export function nextStates(
  workflowKey: unknown,
  stateName: unknown,
  version?: number | null
): string[] {
  return availableTransitions(workflowKey, stateName, version).map((transition) => transition.to);
}

/**
 * Can this job move from `fromState` to `toState`?
 *
 * Guards fail closed: a guard whose context value is absent or false blocks the move.
 */
export function canTransition(
  workflowKey: unknown,
  fromState: unknown,
  toState: unknown,
  context: RrTransitionContext = {},
  options: { reason?: string | null; workflowVersion?: number | null } = {}
): RrTransitionCheck {
  const key = String(workflowKey ?? "");
  const from = String(fromState ?? "");
  const to = String(toState ?? "");

  const compiled = compiledFor(key, options.workflowVersion);
  if (!compiled) {
    return {
      allowed: false,
      reason: "unknown_workflow",
      message: `Unknown Road & Recovery workflow "${key}".`,
    };
  }
  if (!compiled.statesByName.has(from)) {
    return {
      allowed: false,
      reason: "unknown_from_state",
      message: `State "${from}" does not exist in workflow "${key}".`,
    };
  }
  if (!compiled.statesByName.has(to)) {
    return {
      allowed: false,
      reason: "unknown_to_state",
      message: `State "${to}" does not exist in workflow "${key}".`,
    };
  }
  if (compiled.statesByName.get(from)?.kind === "terminal") {
    return {
      allowed: false,
      reason: "terminal_state",
      message: `State "${from}" is terminal in workflow "${key}"; no further transition is possible.`,
    };
  }

  const transition = compiled.transitionsByFrom.get(from)?.get(to);
  if (!transition) {
    return {
      allowed: false,
      reason: "no_such_transition",
      message: `Workflow "${key}" has no transition from "${from}" to "${to}".`,
    };
  }

  const unsatisfiedGuards = (transition.guards ?? []).filter(
    (guard) => context[guard] !== true
  );
  if (unsatisfiedGuards.length > 0) {
    return {
      allowed: false,
      reason: "guard_unsatisfied",
      message: `Transition "${transition.code}" requires ${unsatisfiedGuards.join(", ")}.`,
      unsatisfiedGuards,
    };
  }

  if (transition.requiresReason && !String(options.reason ?? "").trim()) {
    return {
      allowed: false,
      reason: "reason_required",
      message: `Transition "${transition.code}" requires a reason.`,
    };
  }

  return { allowed: true, transition };
}

/**
 * Applies a transition and returns the new state plus the event row to persist.
 *
 * Pure: `occurredAt` and `secondsInPreviousState` are supplied by the caller, never read
 * from the system clock, so the function is deterministic and the tests need no fakes.
 */
export function applyTransition(input: {
  workflowKey: unknown;
  fromState: unknown;
  toState: unknown;
  occurredAt: string;
  context?: RrTransitionContext;
  reason?: string | null;
  secondsInPreviousState?: number | null;
  /** Runs the job on the graph it was CREATED under. Defaults to the active version. */
  workflowVersion?: number | null;
}): RrApplyTransitionResult {
  const check = canTransition(input.workflowKey, input.fromState, input.toState, input.context ?? {}, {
    reason: input.reason,
    workflowVersion: input.workflowVersion,
  });
  if (!check.allowed) return { ok: false, check };

  const key = String(input.workflowKey) as RrWorkflowKey;
  const from = String(input.fromState);
  const to = String(input.toState);
  const definition =
    getWorkflowDefinition(key, input.workflowVersion) ?? RR_WORKFLOW_DEFINITIONS[key];

  const physicalStatusBefore = physicalStatusFor(key, from, input.workflowVersion);
  const physicalStatusAfter = physicalStatusFor(key, to, input.workflowVersion);
  if (!physicalStatusBefore || !physicalStatusAfter) {
    // Unreachable: canTransition already proved both states exist.
    throw new Error(`Workflow "${key}" is missing a physical status mapping.`);
  }

  const wasStanding = isBillableStandingState(key, from, input.workflowVersion);
  const isStanding = isBillableStandingState(key, to, input.workflowVersion);

  return {
    ok: true,
    state: to,
    physicalStatus: physicalStatusAfter,
    event: {
      workflowKey: key,
      workflowVersion: definition.version,
      transitionCode: check.transition.code,
      fromState: from,
      toState: to,
      physicalStatusBefore,
      physicalStatusAfter,
      occurredAt: input.occurredAt,
      secondsInPreviousState: input.secondsInPreviousState ?? null,
      reason: String(input.reason ?? "").trim() || null,
      spawnsLinkedJob: check.transition.spawnsLinkedJob === true,
      entersBillableStandingClock: !wasStanding && isStanding,
      leavesBillableStandingClock: wasStanding && !isStanding,
    },
  };
}

/**
 * Walks a sequence of target states from the workflow's initial state.
 * Returns the first failure, or the full event trail. Used heavily by the tests.
 */
export function replayPath(
  workflowKey: RrWorkflowKey,
  path: readonly string[],
  context: RrTransitionContext = {},
  startAt = "1970-01-01T00:00:00.000Z"
): { ok: true; events: RrStateTransitionEvent[]; finalState: string } | { ok: false; failedAt: string; check: Extract<RrTransitionCheck, { allowed: false }> } {
  let current = initialStateFor(workflowKey);
  const events: RrStateTransitionEvent[] = [];

  for (const target of path) {
    const transition = COMPILED[workflowKey].transitionsByFrom.get(current)?.get(target);
    const result = applyTransition({
      workflowKey,
      fromState: current,
      toState: target,
      occurredAt: startAt,
      context,
      // Supply a reason wherever the graph demands one so callers can assert on the
      // graph shape rather than on reason plumbing.
      reason: transition?.requiresReason ? "test-supplied reason" : null,
    });
    if (!result.ok) return { ok: false, failedAt: target, check: result.check };
    events.push(result.event);
    current = result.state;
  }

  return { ok: true, events, finalState: current };
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

/** Every state reachable from the initial state, following declared transitions. */
export function reachableStates(workflowKey: RrWorkflowKey): Set<string> {
  const compiled = COMPILED[workflowKey];
  const seen = new Set<string>([compiled.definition.initialState]);
  const queue = [compiled.definition.initialState];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const bucket = compiled.transitionsByFrom.get(current);
    if (!bucket) continue;
    for (const target of bucket.keys()) {
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }

  return seen;
}

export function validateWorkflowDefinition(definition: RrWorkflowDefinition): void {
  const key = definition.workflowKey;
  const names = new Set(definition.states.map((entry) => entry.state));

  if (!names.has(definition.initialState)) {
    throw new Error(`Workflow "${key}" initial state "${definition.initialState}" is not declared.`);
  }

  for (const entry of definition.states) {
    if (!RR_PHYSICAL_STATUSES.includes(entry.physicalStatus)) {
      throw new Error(
        `Workflow "${key}" state "${entry.state}" maps to unknown physical status "${entry.physicalStatus}".`
      );
    }
  }

  for (const transition of definition.transitions) {
    if (transition.from !== "*" && !names.has(transition.from)) {
      throw new Error(
        `Workflow "${key}" transition "${transition.code}" leaves undeclared state "${transition.from}".`
      );
    }
    if (!names.has(transition.to)) {
      throw new Error(
        `Workflow "${key}" transition "${transition.code}" enters undeclared state "${transition.to}".`
      );
    }
    for (const guard of transition.guards ?? []) {
      if (!RR_GUARDS.includes(guard)) {
        throw new Error(
          `Workflow "${key}" transition "${transition.code}" names unknown guard "${guard}".`
        );
      }
    }
  }

  if (definition.states.filter((entry) => entry.kind === "terminal").length === 0) {
    throw new Error(`Workflow "${key}" declares no terminal state.`);
  }

  const reachable = reachableStates(key);
  const orphans = [...names].filter((name) => !reachable.has(name));
  if (orphans.length > 0) {
    throw new Error(`Workflow "${key}" has unreachable state(s): ${orphans.join(", ")}.`);
  }

  // Every non-terminal state must be able to reach a terminal state, or a job could be
  // stranded with no lawful way to close.
  const terminals = new Set(terminalStates(key));
  for (const name of names) {
    if (terminals.has(name)) continue;
    const seen = new Set<string>([name]);
    const queue = [name];
    let escapes = false;
    while (queue.length > 0 && !escapes) {
      const current = queue.shift() as string;
      for (const target of COMPILED[key].transitionsByFrom.get(current)?.keys() ?? []) {
        if (terminals.has(target)) {
          escapes = true;
          break;
        }
        if (seen.has(target)) continue;
        seen.add(target);
        queue.push(target);
      }
    }
    if (!escapes) {
      throw new Error(`Workflow "${key}" state "${name}" cannot reach a terminal state.`);
    }
  }

  const standingStates = definition.states.filter((entry) => entry.billableStandingClock === true);
  if (standingStates.length > 1) {
    throw new Error(
      `Workflow "${key}" declares ${standingStates.length} billable standing states; exactly one is allowed.`
    );
  }
}

export function validateAllWorkflowDefinitions(): void {
  for (const key of RR_WORKFLOW_KEYS) {
    for (const definition of RR_WORKFLOW_VERSIONS[key]) {
      validateWorkflowDefinition(definition);
    }
  }
}

/**
 * BYSTAND's state graph must not be a towing graph.
 *
 * This is the state-machine half of the BYSTAND separation (the catalogue half is
 * assertBystandIndependence() in service-types.ts). It asserts the absence of the
 * towing/custody states, the presence of the standing-time states, that the billable
 * clock starts on scene rather than at dispatch, and that conversion to recovery is a
 * spawn rather than a state hand-off.
 */
export function assertBystandStateMachineIndependence(): void {
  const bystand = RR_WORKFLOW_DEFINITIONS.bystand;
  const states = new Set(bystand.states.map((entry) => entry.state));

  const towOnlyStates = [
    "loading",
    "secured",
    "in_transit",
    "arrived_destination",
    "offloading",
    "storage_in",
    "handover_pending",
    "handed_over",
    "departing_scene",
    "assessing",
    "scene_cleared",
    "load_secured",
    "rigging",
    "recovery_in_progress",
  ];
  for (const forbidden of towOnlyStates) {
    if (states.has(forbidden)) {
      throw new Error(
        `BYSTAND invariant: the bystand workflow must not declare towing state "${forbidden}".`
      );
    }
  }

  for (const required of ["standing_by", "stand_down_requested", "stood_down", "departed_scene"]) {
    if (!states.has(required)) {
      throw new Error(`BYSTAND invariant: the bystand workflow is missing state "${required}".`);
    }
  }

  const standing = bystand.states.filter((entry) => entry.billableStandingClock === true);
  if (standing.length !== 1 || standing[0].state !== "standing_by") {
    throw new Error(
      "BYSTAND invariant: exactly one billable standing state is required, and it must be standing_by."
    );
  }

  // No other workflow may claim a billable standing clock.
  for (const key of RR_WORKFLOW_KEYS) {
    if (key === "bystand") continue;
    const offenders = RR_WORKFLOW_DEFINITIONS[key].states.filter(
      (entry) => entry.billableStandingClock === true
    );
    if (offenders.length > 0) {
      throw new Error(
        `BYSTAND invariant: workflow "${key}" must not declare a billable standing clock.`
      );
    }
  }

  const conversion = bystand.transitions.find((entry) => entry.code === "convert_to_recovery");
  if (!conversion) {
    throw new Error("BYSTAND invariant: convert_to_recovery transition is missing.");
  }
  if (conversion.from !== "standing_by") {
    throw new Error(
      `BYSTAND invariant: conversion to recovery must leave standing_by, found "${conversion.from}".`
    );
  }
  if (conversion.spawnsLinkedJob !== true) {
    throw new Error(
      "BYSTAND invariant: convert_to_recovery must spawn a SEPARATE linked recovery job, not change this job into a tow."
    );
  }

  // A bystand job must still be able to bill and close after conversion.
  const afterConversion = new Set(nextStates("bystand", "converted_to_recovery"));
  if (!afterConversion.has("stand_down_requested")) {
    throw new Error(
      "BYSTAND invariant: after conversion the bystand job must still reach its own stand-down and close-out."
    );
  }

  // Towing workflows must not acquire bystand's standing-time states.
  for (const key of ["tow_recovery", "heavy_recovery"] as const) {
    const towStates = new Set(RR_WORKFLOW_DEFINITIONS[key].states.map((entry) => entry.state));
    for (const bystandOnly of ["standing_by", "bystand_requested", "stood_down"]) {
      if (towStates.has(bystandOnly)) {
        throw new Error(
          `BYSTAND invariant: towing workflow "${key}" must not declare bystand state "${bystandOnly}".`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Seed serialisation
// ---------------------------------------------------------------------------

export type RrWorkflowSeedJson = {
  workflow_key: string;
  version: number;
  initial_state: string;
  states: Array<{
    state: string;
    kind: RrStateKind;
    physical_status: RrPhysicalStatus;
    billable_standing_clock: boolean;
    description: string | null;
  }>;
  transitions: Array<{
    code: string;
    from: string;
    to: string;
    guards: string[];
    spawns_linked_job: boolean;
    requires_reason: boolean;
  }>;
};

/**
 * A workflow definition in the exact JSON shape sql/070 seeds into
 * public.rr_workflow_definitions.definition.
 *
 * The migration's JSON blocks were generated from this function, and
 * tests/road-recovery-seed-parity.test.ts parses them back and compares them against
 * this output on every run — so the database seed and this module provably cannot drift.
 *
 * Emitted in declaration order with every field always present (explicit nulls, false and
 * empty arrays rather than omissions) so the serialisation is byte-stable.
 *
 * NOTE: wildcard ("*") transitions are emitted UNEXPANDED, exactly as declared. Expansion
 * is a runtime concern of this module; the stored definition stays compact and readable.
 */
/**
 * The state a job is CREATED in for this workflow.
 *
 * Declared as workflow data rather than hardcoded in the service layer, because the
 * answer genuinely differs per workflow: a tow job is already logged by the act of being
 * captured, a storage job is not yet checked in. Hardcoding one answer silently created
 * storage jobs in a state their own workflow does not contain.
 */
export function creationStateFor(
  workflowKey: string,
  version?: number | null
): string | null {
  const definition =
    getWorkflowDefinition(workflowKey as RrWorkflowKey, version) ??
    RR_WORKFLOW_DEFINITIONS[workflowKey as RrWorkflowKey];
  if (!definition) return null;
  return definition.creationState ?? definition.initialState;
}

export function workflowDefinitionSeedJson(
  workflowKey: RrWorkflowKey,
  version?: number | null
): RrWorkflowSeedJson {
  const definition =
    getWorkflowDefinition(workflowKey, version) ?? RR_WORKFLOW_DEFINITIONS[workflowKey];
  return {
    workflow_key: definition.workflowKey,
    version: definition.version,
    initial_state: definition.initialState,
    states: definition.states.map((entry) => ({
      state: entry.state,
      kind: entry.kind,
      physical_status: entry.physicalStatus,
      billable_standing_clock: entry.billableStandingClock === true,
      description: entry.description ?? null,
    })),
    transitions: definition.transitions.map((entry) => ({
      code: entry.code,
      from: entry.from,
      to: entry.to,
      guards: [...(entry.guards ?? [])],
      spawns_linked_job: entry.spawnsLinkedJob === true,
      requires_reason: entry.requiresReason === true,
    })),
  };
}

/** Guards against a tow_subtype-style construct appearing in any workflow definition. */
export function assertNoTowSubtypeInWorkflows(): void {
  const forbidden = /tow[_\s-]?subtype/i;
  for (const key of RR_WORKFLOW_KEYS) {
    const serialised = JSON.stringify(RR_WORKFLOW_DEFINITIONS[key]);
    if (forbidden.test(serialised)) {
      throw new Error(`Tow-subtype invariant: workflow "${key}" references a tow subtype.`);
    }
  }
}
