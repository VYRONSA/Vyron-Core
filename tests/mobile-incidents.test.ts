import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  incidentPriority,
  incidentUrgencyReason,
  reportIncident,
  RR_INCIDENT_CATEGORIES,
  RR_INCIDENT_CATEGORY_LABELS,
  RR_INCIDENT_SEVERITIES,
  RR_INCIDENT_SEVERITY_LABELS,
} from "@/lib/mobile/incidents";

/**
 * Incident reporting, tested as behaviour.
 *
 * The two things that matter most here are that a report filed twice produces
 * one incident, and that a position is never invented. Everything else is
 * wording an employee reads under pressure.
 */

const VALID_ID = "3f2ab8c7-0660-4950-a0d6-fdd293a072da";

/** Minimal stand-in for the incidents table, including its primary key. */
function incidentStore(seed: string[] = []) {
  const ids = new Set(seed);
  const rows: Record<string, unknown>[] = [];
  const client = {
    from() {
      const builder: Record<string, unknown> = {
        insert(row: Record<string, unknown>) {
          const id = String(row.id);
          if (ids.has(id)) {
            (builder as { _error?: unknown })._error = { code: "23505", message: "duplicate key" };
          } else {
            ids.add(id);
            rows.push(row);
            (builder as { _row?: unknown })._row = { id };
          }
          return builder;
        },
        select: () => builder,
        async maybeSingle() {
          const error = (builder as { _error?: unknown })._error;
          if (error) return { data: null, error };
          return { data: (builder as { _row?: unknown })._row ?? null, error: null };
        },
      };
      return builder;
    },
  };
  return { client: client as never, rows };
}

const base = {
  companyId: "11111111-1111-1111-1111-111111111111",
  employeeId: "22222222-2222-2222-2222-222222222222",
  title: "",
  description: "A pallet fell from the top rack. Nobody was hit.",
  category: "near_miss",
  severity: "medium",
  latitude: -33.9249,
  longitude: 18.4241,
  gpsAccuracy: 8,
  occurredAt: "2026-08-25T09:15:00.000Z",
  peopleInvolved: "Two warehouse staff",
  immediateDanger: false,
  emergencyRequired: false,
  metadata: {},
};

describe("incidents — filing one", () => {
  it("accepts a complete report", async () => {
    const store = incidentStore();
    const result = await reportIncident(store.client, { ...base, incidentId: VALID_ID });
    assert.equal(result.ok, true);
    assert.equal(result.ok === true ? result.created : null, true);
    assert.equal(store.rows.length, 1);
  });

  it("writes a usable title when the employee did not type one", async () => {
    const store = incidentStore();
    await reportIncident(store.client, { ...base, incidentId: VALID_ID, title: "" });
    assert.equal(store.rows[0].title, `${RR_INCIDENT_CATEGORY_LABELS.near_miss} reported`);
  });

  it("refuses a report with nothing written in it", async () => {
    const store = incidentStore();
    const result = await reportIncident(store.client, { ...base, incidentId: VALID_ID, description: "   " });
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.error : "", /describe what happened/i);
  });

  it("refuses a reference that is not a real id", async () => {
    const store = incidentStore();
    const result = await reportIncident(store.client, { ...base, incidentId: "not-a-uuid" });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false ? result.status : null, 400);
  });
});

describe("incidents — filed twice, recorded once", () => {
  /**
   * The queued case: the report reached the server, the response was lost, the
   * app retried with the same id. A second incident here would mean a control
   * room dispatching twice to one event.
   */
  it("a retry of the same report does not create a second incident", async () => {
    const store = incidentStore();
    const first = await reportIncident(store.client, { ...base, incidentId: VALID_ID });
    const second = await reportIncident(store.client, { ...base, incidentId: VALID_ID });

    assert.equal(first.ok && first.created, true, "the first attempt files it");
    assert.equal(second.ok, true, "the retry must succeed, not error");
    assert.equal(second.ok === true ? second.created : null, false, "and must not create a second");
    assert.equal(store.rows.length, 1, "exactly one incident");
  });

  it("tells the caller which of the two happened", async () => {
    const store = incidentStore([VALID_ID]);
    const result = await reportIncident(store.client, { ...base, incidentId: VALID_ID });
    assert.equal(result.ok === true ? result.created : null, false);
    assert.equal(result.ok === true ? result.incidentId : null, VALID_ID);
  });
});

describe("incidents — a position is never invented", () => {
  it("stores a real position with its accuracy", async () => {
    const store = incidentStore();
    await reportIncident(store.client, { ...base, incidentId: VALID_ID });
    assert.equal(store.rows[0].latitude, -33.9249);
    assert.equal(store.rows[0].gps_accuracy, 8);
  });

  it("stores NULL rather than a guess when there was no fix", async () => {
    const store = incidentStore();
    await reportIncident(store.client, {
      ...base, incidentId: VALID_ID, latitude: null, longitude: null, gpsAccuracy: null,
    });
    assert.equal(store.rows[0].latitude, null);
    assert.equal(store.rows[0].longitude, null);
    assert.equal(store.rows[0].gps_accuracy, null, "accuracy must not survive a missing position");
  });

  it("drops a half-position rather than storing one coordinate", async () => {
    const store = incidentStore();
    await reportIncident(store.client, { ...base, incidentId: VALID_ID, longitude: null });
    assert.equal(store.rows[0].latitude, null);
    assert.equal(store.rows[0].longitude, null);
  });

  it("never records accuracy 0 to mean 'unknown'", async () => {
    const store = incidentStore();
    await reportIncident(store.client, {
      ...base, incidentId: VALID_ID, latitude: null, longitude: null, gpsAccuracy: 0,
    });
    assert.notEqual(store.rows[0].gps_accuracy, 0);
    assert.equal(store.rows[0].gps_accuracy, null);
  });
});

describe("incidents — the two clocks stay separate", () => {
  it("keeps the employee's occurred_at and never sets created_at", async () => {
    const store = incidentStore();
    await reportIncident(store.client, { ...base, incidentId: VALID_ID });
    assert.equal(store.rows[0].occurred_at, "2026-08-25T09:15:00.000Z");
    assert.equal(store.rows[0].created_at, undefined, "the server's clock is the database's to set");
  });
});

describe("incidents — unrecognised values are dropped, not stored", () => {
  it("stores NULL for a category the system does not know", async () => {
    const store = incidentStore();
    await reportIncident(store.client, { ...base, incidentId: VALID_ID, category: "alien_abduction" });
    assert.equal(store.rows[0].category, null);
  });

  it("stores NULL for an unrecognised severity", async () => {
    const store = incidentStore();
    await reportIncident(store.client, { ...base, incidentId: VALID_ID, severity: "apocalyptic" });
    assert.equal(store.rows[0].severity, null);
  });

  it("accepts every category and severity the app offers", async () => {
    for (const category of RR_INCIDENT_CATEGORIES) {
      const store = incidentStore();
      await reportIncident(store.client, { ...base, incidentId: VALID_ID, category });
      assert.equal(store.rows[0].category, category, `${category} should be storable`);
    }
    for (const severity of RR_INCIDENT_SEVERITIES) {
      const store = incidentStore();
      await reportIncident(store.client, { ...base, incidentId: VALID_ID, severity });
      assert.equal(store.rows[0].severity, severity, `${severity} should be storable`);
    }
  });
});

describe("incidents — what a control room sees first", () => {
  const p = (over: Partial<Parameters<typeof incidentPriority>[0]>) =>
    incidentPriority({ immediateDanger: false, emergencyRequired: false, severity: "low", ...over });

  it("puts an emergency above everything else", () => {
    assert.ok(p({ emergencyRequired: true, severity: "low" }) > p({ severity: "critical" }));
  });

  it("puts somebody still in danger above a worse outcome already over", () => {
    assert.ok(p({ immediateDanger: true, severity: "low" }) > p({ severity: "critical" }));
  });

  it("orders by severity when nobody is at risk", () => {
    assert.ok(p({ severity: "critical" }) > p({ severity: "high" }));
    assert.ok(p({ severity: "high" }) > p({ severity: "medium" }));
    assert.ok(p({ severity: "medium" }) > p({ severity: "low" }));
  });

  it("explains its own ordering in a sentence an operator can act on", () => {
    assert.match(
      incidentUrgencyReason({ immediateDanger: false, emergencyRequired: true, severity: "low" }),
      /emergency services/i
    );
    assert.match(
      incidentUrgencyReason({ immediateDanger: true, emergencyRequired: false, severity: "low" }),
      /still be in danger/i
    );
    assert.match(
      incidentUrgencyReason({ immediateDanger: false, emergencyRequired: false, severity: "critical" }),
      /critical/i
    );
  });

  it("never shows an employee a database value", () => {
    for (const category of RR_INCIDENT_CATEGORIES) {
      const label = RR_INCIDENT_CATEGORY_LABELS[category];
      assert.ok(label && !label.includes("_"), `${category} needs a human label`);
    }
    for (const severity of RR_INCIDENT_SEVERITIES) {
      assert.ok(RR_INCIDENT_SEVERITY_LABELS[severity], `${severity} needs a human label`);
    }
  });
});

import {
  canSubmit,
  draftSendState,
  draftStatusText,
  missingFromDraft,
  newDraft,
  type RrIncidentDraft,
} from "@/lib/mobile/incident-drafts";

describe("incident drafts — nothing an employee writes is lost or overclaimed", () => {
  const draft = (over: Partial<RrIncidentDraft> = {}): RrIncidentDraft => ({
    ...newDraft("11111111-1111-1111-1111-111111111111"),
    ...over,
  });

  it("a new draft starts on the device, not on the server", () => {
    const d = draft();
    assert.equal(d.state, "draft");
    assert.match(draftStatusText(d, true).detail, /not sent/i);
  });

  it("says what is still missing, in the employee's words", () => {
    const missing = missingFromDraft(draft());
    assert.equal(canSubmit(draft()), false);
    assert.ok(missing.length >= 3);
    for (const item of missing) {
      assert.doesNotMatch(item, /null|undefined|_|field|required$/i, `"${item}" reads like a database error`);
    }
  });

  it("becomes submittable once the three things that matter are answered", () => {
    const ready = draft({ category: "injury", severity: "high", description: "Cut hand on sheet metal." });
    assert.deepEqual(missingFromDraft(ready), []);
    assert.equal(canSubmit(ready), true);
  });

  it("offline, it promises to send itself and asks nothing of the employee", () => {
    const status = draftStatusText(draft({ state: "submitting" }), false);
    assert.match(status.title, /waiting for connection/i);
    assert.match(status.detail, /safely saved|automatically/i);
  });

  it("NEVER says submitted until the server has confirmed it", () => {
    for (const state of ["draft", "saved_on_device", "submitting", "failed"] as const) {
      const status = draftStatusText(draft({ state }), true);
      assert.doesNotMatch(
        `${status.title} ${status.detail}`,
        /^Submitted$|control room has your report/i,
        `state "${state}" must not claim the server has it`
      );
    }
    const confirmed = draftStatusText(draft({ state: "submitted" }), true);
    assert.equal(confirmed.title, "Submitted");
  });

  it("never shows an employee a word from the implementation", () => {
    const forbidden = /operationId|IndexedDB|outbox|queue|idempot|receipt|uuid|payload|409|sync/i;
    for (const state of ["draft", "saved_on_device", "submitting", "submitted", "failed"] as const) {
      for (const online of [true, false]) {
        const status = draftStatusText(draft({ state }), online);
        assert.doesNotMatch(`${status.title} ${status.detail}`, forbidden, `leaked in ${state}`);
      }
    }
  });
});

/**
 * The Home summary counts, and the promise attached to them.
 *
 * The bug this covers shipped as: an unfinished draft was counted alongside
 * queued work and shown as "waiting to send … they will send themselves when
 * you have signal." Nobody had pressed send on it, so it never would.
 */
describe("what Home may promise about reports on the device", () => {
  const at = (state: RrIncidentDraft["state"]): RrIncidentDraft =>
    ({ ...newDraft("c1"), state }) as RrIncidentDraft;

  it("counts work the queue owns as waiting to send", () => {
    const counts = draftSendState([at("submitting"), at("saved_on_device")]);
    assert.equal(counts.queued, 2);
    assert.equal(counts.unfinished, 0);
  });

  it("never counts an unfinished draft as waiting to send", () => {
    const counts = draftSendState([at("draft")]);
    assert.equal(counts.queued, 0, "a draft sends itself only if somebody sends it");
    assert.equal(counts.unfinished, 1);
  });

  it("keeps failures separate from work still on its way", () => {
    const counts = draftSendState([at("failed"), at("submitting")]);
    assert.equal(counts.needsAttention, 1);
    assert.equal(counts.queued, 1);
    assert.equal(counts.unfinished, 0);
  });

  it("ignores reports the control room already has", () => {
    const counts = draftSendState([at("submitted"), at("submitted")]);
    assert.deepEqual(counts, { queued: 0, unfinished: 0, needsAttention: 0 });
  });

  it("separates a mixed device the way an employee would read it", () => {
    const counts = draftSendState([
      at("draft"),
      at("submitting"),
      at("saved_on_device"),
      at("failed"),
      at("submitted"),
    ]);
    assert.deepEqual(counts, { queued: 2, unfinished: 1, needsAttention: 1 });
  });

  it("still tells the truth about a single draft on its own card", () => {
    const status = draftStatusText(at("draft"), true);
    assert.match(status.detail, /not sent yet/i);
  });
});

/**
 * What sign-out is allowed to destroy.
 *
 * Signing out clears the device's local stores, and those stores are where an
 * employee's unsent reports and photographs live. The count that gates the
 * button therefore has to include everything still owed to them - work on its
 * way AND work that stopped with a problem - because both would be lost.
 */
describe("sign-out may not discard unsent work", () => {
  const at = (state: RrIncidentDraft["state"]): RrIncidentDraft =>
    ({ ...newDraft("c1"), state }) as RrIncidentDraft;

  const gate = (drafts: RrIncidentDraft[]) => {
    const counts = draftSendState(drafts);
    return counts.queued + counts.needsAttention;
  };

  it("blocks while a report is still on its way", () => {
    assert.ok(gate([at("submitting")]) > 0);
    assert.ok(gate([at("saved_on_device")]) > 0);
  });

  it("blocks while a report needs attention, not just while it is sending", () => {
    // A failed report is still the employee's, and clearing it would be the
    // quietest possible way to lose a safety report.
    assert.ok(gate([at("failed")]) > 0);
  });

  it("allows sign-out once the control room has everything", () => {
    assert.equal(gate([at("submitted"), at("submitted")]), 0);
    assert.equal(gate([]), 0);
  });

  it("does not count an unfinished draft as unsent work", () => {
    // A draft was never submitted, so nothing is owed to the server. It is the
    // employee's own scratch note, and it goes with the handover.
    assert.equal(gate([at("draft")]), 0);
  });
});
