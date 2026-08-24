import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { asBooleanOrNull } from "@/lib/road-recovery/coerce";

/**
 * Safety-flag intake.
 *
 * The route stores `asBooleanOrNull(body.x) === true`, so this exercises the
 * exact expression the handler uses. The property that matters: a flag is true
 * ONLY when the caller genuinely said true. Everything else — absent, null,
 * empty, "false", 0, "yes", an object — must resolve to false.
 *
 * A false negative here means a driver is not warned about a casualty. A false
 * positive means every job screams hazmat until nobody reads the banner. Both
 * are safety failures, so the coercion is pinned by test rather than trusted.
 */
const intakeFlag = (value: unknown): boolean => asBooleanOrNull(value) === true;

describe("safety intake flags", () => {
  it("is true only for a real true", () => {
    assert.equal(intakeFlag(true), true);
    assert.equal(intakeFlag("true"), true);
  });

  it("defaults to false when the controller says nothing", () => {
    assert.equal(intakeFlag(undefined), false);
    assert.equal(intakeFlag(null), false);
    assert.equal(intakeFlag(""), false);
  });

  it("never turns a falsey or ambiguous value into a warning", () => {
    for (const value of [false, "false", 0, "0", "no", "off", [], {}, "TRUE ", "yes", 1, "1"]) {
      assert.equal(intakeFlag(value), false, `"${JSON.stringify(value)}" produced a safety warning`);
    }
  });

  it("is a strict boolean, never null, so the NOT NULL column is always satisfied", () => {
    for (const value of [undefined, null, "", true, false, "true", "nonsense"]) {
      assert.equal(typeof intakeFlag(value), "boolean");
    }
  });
});

describe("safety intake — the two flags are independent", () => {
  it("casualty and hazmat do not influence each other", () => {
    const job = { casualtyFlag: true, hazmatFlag: undefined };
    assert.equal(intakeFlag(job.casualtyFlag), true);
    assert.equal(intakeFlag(job.hazmatFlag), false);
  });
});
