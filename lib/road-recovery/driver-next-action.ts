/**
 * The ONE thing the driver should do next.
 *
 * The driver screen's job is to answer four questions within two seconds: what job am I
 * on, where is it, what state is it in, and what do I do now. That last question was
 * previously answered by presenting every legal action as a row of equal buttons and
 * letting the driver work it out — which is exactly what a person standing beside a
 * wrecked vehicle in the rain cannot do.
 *
 * This resolver turns (assignment status, service state, workflow) into a single primary
 * action plus a short list of secondary ones. It is a pure function so the decision is
 * unit-tested rather than tangled through JSX, and so the same answer drives the button,
 * the status chip and the guidance line — they cannot disagree.
 *
 * It deliberately does NOT decide whether a transition is legal. `lib/road-recovery/
 * state-machine.ts` is the authority for that and the server re-checks every transition.
 * This only decides what to PUT IN FRONT OF THE DRIVER; an action offered here that the
 * server refuses surfaces as an ordinary error.
 */

/** Actions the driver screen can perform. Each maps to an existing API call. */
export type RrDriverActionKind =
  | "accept"
  | "decline"
  | "navigate"
  | "start_travel"
  | "arrive"
  | "capture_evidence"
  | "begin_standing"
  | "pause_standing"
  | "resume_standing"
  | "stand_down"
  | "submit_report"
  | "view_requirements"
  | "call_control_room";

export type RrDriverAction = {
  kind: RrDriverActionKind;
  label: string;
  /** Primary actions are rendered as the single large button. */
  tone: "primary" | "neutral" | "danger";
};

export type RrDriverStatusTone = "offered" | "active" | "travelling" | "onsite" | "standing" | "done";

export type RrDriverNextAction = {
  /** Short status word for the chip — the driver's current reality. */
  statusLabel: string;
  statusTone: RrDriverStatusTone;
  /** One sentence telling the driver what is expected of them right now. */
  guidance: string;
  /** The single large button. Null when the job is waiting on somebody else. */
  primary: RrDriverAction | null;
  /** Everything else, shown behind a "More" disclosure. */
  secondary: RrDriverAction[];
};

const NAVIGATE: RrDriverAction = { kind: "navigate", label: "Navigate", tone: "neutral" };
const EVIDENCE: RrDriverAction = { kind: "capture_evidence", label: "Add photo", tone: "neutral" };
const REQUIREMENTS: RrDriverAction = {
  kind: "view_requirements",
  label: "What evidence is needed",
  tone: "neutral",
};
const CALL: RrDriverAction = { kind: "call_control_room", label: "Call control room", tone: "neutral" };

export type RrDriverJobContext = {
  /** rr_dispatch_assignments.assignment_status */
  assignmentStatus: string;
  /** rr_service_jobs.service_state */
  serviceState: string;
  /** rr_service_jobs.workflow_key */
  workflowKey?: string | null;
  /** True while the BYSTAND billable clock is running. */
  standingNow?: boolean;
  /** States this workflow treats as a paused standing clock. */
  pausedStates?: string[] | null;
};

function norm(value: string | null | undefined): string {
  return String(value || "").trim().toLowerCase();
}

/**
 * Resolve the driver's next action.
 *
 * Order matters: an unanswered offer outranks everything, because a job the driver has
 * not accepted is not yet theirs to progress.
 */
export function resolveDriverNextAction(context: RrDriverJobContext): RrDriverNextAction {
  const assignment = norm(context.assignmentStatus);
  const state = norm(context.serviceState);
  const workflow = norm(context.workflowKey);
  const paused = (context.pausedStates || []).map(norm);

  // 1. Offered and unanswered — the only thing that matters is accept or decline.
  if (assignment === "offered") {
    return {
      statusLabel: "New job",
      statusTone: "offered",
      guidance: "Review the job and accept it, or decline with a reason.",
      primary: { kind: "accept", label: "Accept job", tone: "primary" },
      secondary: [{ kind: "decline", label: "Decline", tone: "danger" }, NAVIGATE, CALL],
    };
  }

  // 2. Accepted but not yet moving — go.
  if (state === "accepted" || state === "assigned") {
    return {
      statusLabel: "Accepted",
      statusTone: "active",
      guidance: "Head to the scene. Start travel so the control room can track you.",
      primary: { kind: "start_travel", label: "Start travel", tone: "primary" },
      secondary: [NAVIGATE, CALL],
    };
  }

  // 3. On the road — the next milestone is arrival.
  if (state === "en_route") {
    return {
      statusLabel: "En route",
      statusTone: "travelling",
      guidance: "Tap Arrived when you reach the scene. Your GPS position is recorded with it.",
      primary: { kind: "arrive", label: "I have arrived", tone: "primary" },
      secondary: [NAVIGATE, CALL],
    };
  }

  // 4. BYSTAND has its own clock, and the clock outranks evidence.
  if (workflow === "bystand") {
    if (context.standingNow) {
      return {
        statusLabel: "Standing",
        statusTone: "standing",
        guidance: "The billable standing clock is running. Pause it if you hand over or leave.",
        primary: { kind: "pause_standing", label: "Pause standing", tone: "neutral" },
        secondary: [
          { kind: "stand_down", label: "Request stand-down", tone: "danger" },
          EVIDENCE,
          CALL,
        ],
      };
    }
    if (paused.includes(state)) {
      return {
        statusLabel: "Paused",
        statusTone: "standing",
        guidance: "Standing is paused. Resume when you are back on the scene.",
        primary: { kind: "resume_standing", label: "Resume standing", tone: "primary" },
        secondary: [{ kind: "stand_down", label: "Request stand-down", tone: "danger" }, EVIDENCE, CALL],
      };
    }
    // BYSTAND's arrival state is `arrived_on_scene` (state-machine.ts), NOT the
    // recovery workflow's `on_scene`. Both are accepted because getting this
    // wrong strands the driver on the one screen that starts the billable clock.
    if (state === "arrived_on_scene" || state === "on_scene") {
      return {
        statusLabel: "On scene",
        statusTone: "onsite",
        guidance: "Start the standing clock so attendance time is recorded.",
        primary: { kind: "begin_standing", label: "Start standing", tone: "primary" },
        secondary: [EVIDENCE, REQUIREMENTS, CALL],
      };
    }
    // The attendance is over and the deliverable is outstanding. This is the one
    // state `submit_report` is legal from, and it is the whole point of the job.
    if (state === "departed_scene") {
      return {
        statusLabel: "Report due",
        statusTone: "active",
        guidance: "You have left the scene. File your observation report to close this attendance.",
        primary: { kind: "submit_report", label: "Submit report", tone: "primary" },
        secondary: [EVIDENCE, CALL],
      };
    }
  }

  // 5. On scene on a recovery/tow job — evidence is the gate to everything downstream.
  if (state === "on_scene" || state === "assessing" || state === "scene_assessment") {
    return {
      statusLabel: "On scene",
      statusTone: "onsite",
      guidance: "Capture the required photos before the job can move on.",
      primary: { kind: "capture_evidence", label: "Capture evidence", tone: "primary" },
      secondary: [REQUIREMENTS, CALL],
    };
  }

  // 6. Recovery/tow under way.
  if (state === "recovery_in_progress" || state === "tow_recovery") {
    return {
      statusLabel: "Recovery",
      statusTone: "onsite",
      guidance: "Recovery is under way. Add photos as you work.",
      primary: { kind: "capture_evidence", label: "Add photo", tone: "primary" },
      secondary: [REQUIREMENTS, NAVIGATE, CALL],
    };
  }

  // 7. Storage / yard leg.
  if (state.startsWith("storage")) {
    return {
      statusLabel: "To yard",
      statusTone: "onsite",
      guidance: "Deliver to the yard and capture the handover evidence.",
      primary: { kind: "capture_evidence", label: "Capture handover", tone: "primary" },
      secondary: [NAVIGATE, REQUIREMENTS, CALL],
    };
  }

  // 8. Finished states — nothing for the driver to do.
  if (state === "completed" || state === "closed" || state === "cancelled") {
    return {
      statusLabel: state === "cancelled" ? "Cancelled" : "Complete",
      statusTone: "done",
      guidance:
        state === "cancelled"
          ? "This job was cancelled. Nothing further is needed from you."
          : "This job is finished. The control room is reviewing the billing pack.",
      primary: null,
      secondary: [REQUIREMENTS],
    };
  }

  /**
   * 9. Anything else — a state this vertical added, or one owned by the control room.
   *
   * Deliberately offers no primary action rather than guessing one: inventing a
   * transition for an unrecognised state is how a driver ends up pushing a job into a
   * state the workflow did not intend.
   */
  return {
    statusLabel: "In progress",
    statusTone: "active",
    guidance: "The control room is handling the next step on this job.",
    primary: null,
    secondary: [EVIDENCE, REQUIREMENTS, CALL],
  };
}

/** Colour token per status, so the chip and the card border always agree. */
export const RR_DRIVER_STATUS_TONE_CLASS: Record<RrDriverStatusTone, string> = {
  offered: "bg-amber-100 text-amber-900 ring-amber-300",
  active: "bg-sky-100 text-sky-900 ring-sky-300",
  travelling: "bg-indigo-100 text-indigo-900 ring-indigo-300",
  onsite: "bg-cyan-100 text-cyan-900 ring-cyan-300",
  standing: "bg-violet-100 text-violet-900 ring-violet-300",
  done: "bg-slate-200 text-slate-700 ring-slate-300",
};
