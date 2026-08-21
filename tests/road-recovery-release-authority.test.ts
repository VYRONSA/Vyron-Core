/**
 * Phase 4 — the release and disposal authority decision, as a pure function.
 *
 * These two guards were declared by the storage workflow in Phase 0 and never resolved,
 * which made both transitions unreachable through the service layer — the same defect
 * Phase 3 closed for `evidence_complete`.
 *
 * The load-bearing assertions:
 *   - a RELEASE authority never satisfies the DISPOSAL guard, and the reverse
 *   - recorded is not verified
 *   - unexpired is not verified
 *   - every uncertainty fails CLOSED
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RR_AUTHORITY_PARTIES,
  RR_AUTHORITY_TYPES,
  decideAuthority,
  type RrAuthorityRecord,
} from "@/lib/road-recovery/release-authority";

const NOW = "2026-06-15T10:00:00.000Z";

function authority(overrides: Partial<RrAuthorityRecord> = {}): RrAuthorityRecord {
  return {
    id: "auth-1",
    authorityType: "release",
    status: "active",
    validFrom: null,
    expiresAt: null,
    verifiedAt: "2026-06-15T09:00:00.000Z",
    verifiedBy: "controller@alpha.test",
    ...overrides,
  };
}

describe("Phase 4 — authority vocabulary", () => {
  it("declares exactly two authority types", () => {
    assert.deepEqual([...RR_AUTHORITY_TYPES], ["release", "disposal"]);
  });

  it("recognises the parties that can authorise in South Africa", () => {
    for (const party of ["insurer", "owner", "finance_house", "saps", "court", "municipality"]) {
      assert.ok((RR_AUTHORITY_PARTIES as readonly string[]).includes(party));
    }
  });
});

describe("Phase 4 — a verified authority in force opens the gate", () => {
  it("authorises release", () => {
    const decision = decideAuthority([authority()], "release", NOW);
    assert.equal(decision.authorised, true);
    assert.equal(decision.authorityId, "auth-1");
  });

  it("authorises disposal", () => {
    const decision = decideAuthority(
      [authority({ id: "disp-1", authorityType: "disposal" })],
      "disposal",
      NOW
    );
    assert.equal(decision.authorised, true);
    assert.equal(decision.authorityId, "disp-1");
  });

  it("accepts an authority inside its validity window", () => {
    const decision = decideAuthority(
      [authority({ validFrom: "2026-06-01T00:00:00.000Z", expiresAt: "2026-06-30T00:00:00.000Z" })],
      "release",
      NOW
    );
    assert.equal(decision.authorised, true);
  });

  it("picks the verified authority when several exist", () => {
    const decision = decideAuthority(
      [authority({ id: "unverified", verifiedAt: null, verifiedBy: null }), authority({ id: "good" })],
      "release",
      NOW
    );
    assert.equal(decision.authorised, true);
    assert.equal(decision.authorityId, "good");
  });
});

// ---------------------------------------------------------------------------
// The separation that matters most
// ---------------------------------------------------------------------------

describe("Phase 4 — release authority is NOT disposal authority", () => {
  it("a release authority does not authorise disposal", () => {
    const decision = decideAuthority([authority({ authorityType: "release" })], "disposal", NOW);
    assert.equal(decision.authorised, false);
    assert.match(decision.reason, /No disposal authority/i);
  });

  it("a disposal authority does not authorise release", () => {
    const decision = decideAuthority([authority({ authorityType: "disposal" })], "release", NOW);
    assert.equal(decision.authorised, false);
    assert.match(decision.reason, /No release authority/i);
  });

  it("holding both grants both, independently", () => {
    const records = [
      authority({ id: "rel", authorityType: "release" }),
      authority({ id: "dis", authorityType: "disposal" }),
    ];
    assert.equal(decideAuthority(records, "release", NOW).authorityId, "rel");
    assert.equal(decideAuthority(records, "disposal", NOW).authorityId, "dis");
  });

  it("voiding the release authority leaves disposal untouched", () => {
    const records = [
      authority({ id: "rel", authorityType: "release", status: "void" }),
      authority({ id: "dis", authorityType: "disposal" }),
    ];
    assert.equal(decideAuthority(records, "release", NOW).authorised, false);
    assert.equal(decideAuthority(records, "disposal", NOW).authorised, true);
  });
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

describe("Phase 4 — every uncertainty fails closed", () => {
  it("refuses when nothing has been recorded", () => {
    const decision = decideAuthority([], "release", NOW);
    assert.equal(decision.authorised, false);
    assert.equal(decision.authorityId, null);
  });

  it("refuses a voided, expired or superseded authority", () => {
    for (const status of ["void", "expired", "superseded"]) {
      const decision = decideAuthority([authority({ status })], "release", NOW);
      assert.equal(decision.authorised, false, `status ${status} was accepted`);
      assert.match(decision.reason, /voided, expired or superseded/i);
    }
  });

  it("refuses an authority that has not started yet", () => {
    const decision = decideAuthority(
      [authority({ validFrom: "2026-07-01T00:00:00.000Z" })],
      "release",
      NOW
    );
    assert.equal(decision.authorised, false);
    assert.match(decision.reason, /not valid at this time/i);
  });

  it("refuses an authority that has run out", () => {
    const decision = decideAuthority(
      [authority({ expiresAt: "2026-06-01T00:00:00.000Z" })],
      "release",
      NOW
    );
    assert.equal(decision.authorised, false);
    assert.match(decision.reason, /not valid at this time/i);
  });

  it("REFUSES AN UNVERIFIED AUTHORITY — recorded is not verified", () => {
    const decision = decideAuthority(
      [authority({ verifiedAt: null, verifiedBy: null })],
      "release",
      NOW
    );
    assert.equal(decision.authorised, false);
    assert.match(decision.reason, /not been verified/i);
  });

  it("refuses a half-verified authority", () => {
    assert.equal(
      decideAuthority([authority({ verifiedBy: null })], "release", NOW).authorised,
      false
    );
    assert.equal(
      decideAuthority([authority({ verifiedAt: null })], "release", NOW).authorised,
      false
    );
  });

  it("refuses an unparseable evaluation instant rather than guessing", () => {
    const decision = decideAuthority(
      [authority({ expiresAt: "2026-12-31T00:00:00.000Z" })],
      "release",
      "not a date"
    );
    assert.equal(decision.authorised, false);
  });

  it("refuses a status outside the known vocabulary", () => {
    const decision = decideAuthority([authority({ status: "probably_fine" })], "release", NOW);
    assert.equal(decision.authorised, false);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("Phase 4 — the decision is deterministic", () => {
  it("reads no clock of its own", () => {
    const source = decideAuthority.toString();
    assert.equal(/Date\.now\(\)/.test(source), false);
    assert.equal(/new Date\(\s*\)/.test(source), false);
  });

  it("gives the same answer for the same inputs", () => {
    const records = [authority(), authority({ id: "second", status: "void" })];
    assert.deepEqual(
      decideAuthority(records, "release", NOW),
      decideAuthority(records, "release", NOW)
    );
  });

  it("does not depend on the order the authorities arrive in", () => {
    const records = [authority({ id: "a", status: "void" }), authority({ id: "b" })];
    assert.equal(decideAuthority(records, "release", NOW).authorised, true);
    assert.equal(decideAuthority([...records].reverse(), "release", NOW).authorised, true);
  });

  it("an authority valid yesterday and expired today decides differently, on the instant alone", () => {
    const record = authority({ expiresAt: "2026-06-14T00:00:00.000Z" });
    assert.equal(decideAuthority([record], "release", "2026-06-13T10:00:00.000Z").authorised, true);
    assert.equal(decideAuthority([record], "release", NOW).authorised, false);
  });
});
