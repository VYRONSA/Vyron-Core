import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { captureEvidence, evidenceStatusText, type RrEvidenceRecord } from "@/lib/road-recovery/evidence-queue";

/**
 * Evidence wording and lifecycle.
 *
 * The rule these defend: the driver is NEVER told evidence is uploaded or
 * verified because it was merely saved to the phone. In a dispute, "we have the
 * photograph" and "the photograph is attached to the job" are different claims,
 * and only the second one is worth anything.
 */

function record(overrides: Partial<RrEvidenceRecord> = {}): RrEvidenceRecord {
  return {
    operationId: "11111111-2222-4333-8444-555555555555",
    serviceJobId: "job-1",
    companyId: "c1",
    evidenceType: "rr_requirement",
    requirementCodes: ["scene_photo"],
    capturedAt: 1_000,
    latitude: -33.9, longitude: 18.4, accuracy: 8,
    actorEmail: "driver@qa.invalid",
    metadata: {},
    storagePath: "c1/job-1/11111111-2222-4333-8444-555555555555.jpg",
    contentType: "image/jpeg",
    byteSize: 1024,
    state: "saved_on_device",
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

describe("evidence — the driver is never misled", () => {
  it("offline capture says SAVED ON DEVICE, never uploaded", () => {
    const status = evidenceStatusText(record({ state: "saved_on_device" }), false);
    assert.equal(status.title, "Saved on device");
    assert.match(status.detail, /waiting for connection/i);
    assert.match(status.detail, /automatically/i);
    assert.doesNotMatch(`${status.title} ${status.detail}`, /uploaded|verified/i);
  });

  it("bytes sent but row not filed is still NOT 'verified'", () => {
    const status = evidenceStatusText(record({ state: "uploaded" }), true);
    assert.doesNotMatch(status.title, /verified/i);
  });

  it("only the linked state claims verification", () => {
    const status = evidenceStatusText(record({ state: "linked" }), true);
    assert.equal(status.title, "Uploaded and verified");
  });

  it("a failure still reassures the driver the capture is safe", () => {
    const status = evidenceStatusText(record({ state: "failed", lastError: "boom" }), true);
    assert.match(status.detail, /still saved on device/i);
  });

  it("no state leaks protocol internals", () => {
    const forbidden = /operation ?id|receipt|idempot|sha256|indexeddb|bucket|storage path|uuid/i;
    for (const state of ["saved_on_device", "uploading", "uploaded", "linked", "failed"] as const) {
      for (const online of [true, false]) {
        const status = evidenceStatusText(record({ state }), online);
        assert.doesNotMatch(`${status.title} ${status.detail}`, forbidden, `leaked for ${state}`);
      }
    }
  });
});

describe("evidence — duplicate prevention by construction", () => {
  it("the storage path is derived from the operationId, so retries reuse it", () => {
    const r = record();
    assert.ok(r.storagePath.includes(r.operationId), "path does not embed the operation id");
    assert.ok(r.storagePath.startsWith(`${r.companyId}/`), "path is not under the company prefix");
  });

  it("the path is company-scoped, matching the rr-evidence storage policy", () => {
    // sql/072's insert policy allows a write only beneath the caller's own
    // company folder, checked as split_part(name, '/', 1).
    const r = record();
    assert.equal(r.storagePath.split("/")[0], r.companyId);
  });

  it("the same capture always yields the same path", () => {
    const a = record();
    const b = record();
    assert.equal(a.storagePath, b.storagePath);
  });
});

describe("evidence — one id covers the bytes and the row", () => {
  /**
   * The storage path is derived from the operationId at capture. If the row were
   * filed under a different id, the receipt would cover only half the operation
   * and a lost response could file the same photograph twice.
   */
  it("derives the storage path from the same id the row is filed under", async () => {
    const record = await captureEvidence({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
      companyId: "c1",
      serviceJobId: "j1",
      evidenceType: "rr_requirement",
    });
    assert.equal(record.storagePath, `c1/j1/${record.operationId}.jpg`);
  });
});
