import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateSessionValidity,
  revokedRowForUntrackedRequest,
  sessionRowForCurrentLogin,
  type SessionRow,
} from "@/lib/server/session-validation";

/**
 * Force Logout must hold even when the session cookie is deleted, and must not lock a user
 * out after they sign in again (readiness audit D29).
 */
const revokedRow: SessionRow = {
  session_token: "t1",
  revoked_at: "2026-11-19T08:00:00Z",
  last_seen_at: "2026-11-19T07:59:00Z",
  created_at: "2026-11-19T07:00:00Z",
  company_id: "c1",
};

describe("revokedRowForUntrackedRequest", () => {
  it("treats a cookie-less request as revoked when a revocation followed the last sign-in", () => {
    const row = revokedRowForUntrackedRequest("2026-11-19T08:00:00Z", "2026-11-19T07:00:00Z");
    assert.ok(row);
    assert.equal(evaluateSessionValidity(row, null).valid, false);
  });

  it("lets a request through after the user signed in again", () => {
    assert.equal(revokedRowForUntrackedRequest("2026-11-19T08:00:00Z", "2026-11-19T09:00:00Z"), null);
  });

  it("does nothing when the user was never revoked", () => {
    assert.equal(revokedRowForUntrackedRequest(null, "2026-11-19T09:00:00Z"), null);
  });
});

describe("sessionRowForCurrentLogin", () => {
  it("keeps a revoked row that belongs to the current login", () => {
    assert.equal(sessionRowForCurrentLogin(revokedRow, "2026-11-19T07:00:00Z"), revokedRow);
  });

  it("ignores a revoked row from before a new sign-in (no login loop)", () => {
    assert.equal(sessionRowForCurrentLogin(revokedRow, "2026-11-19T08:30:00Z"), null);
  });

  it("passes live rows through untouched", () => {
    const live = { ...revokedRow, revoked_at: null };
    assert.equal(sessionRowForCurrentLogin(live, "2026-11-19T08:30:00Z"), live);
  });
});
