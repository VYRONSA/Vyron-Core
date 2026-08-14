import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MIN_PASSWORD_LENGTH,
  redactSecrets,
  validatePassword,
} from "@/lib/tenant/password-policy";
import { generateTemporaryPassword } from "@/lib/tenant/password-generator";

describe("password policy", () => {
  it("rejects passwords that do not meet the configured requirements", () => {
    const cases: [string, string][] = [
      ["", "A password is required."],
      ["   ", "A password is required."],
      ["Ab1", `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`],
      ["alllowercase1", "Password must contain an upper-case letter."],
      ["ALLUPPERCASE1", "Password must contain a lower-case letter."],
      ["NoDigitsHere", "Password must contain a number."],
    ];

    for (const [password, message] of cases) {
      const result = validatePassword(password);
      assert.equal(result.ok, false, `${password} should be rejected`);
      if (!result.ok) assert.equal(result.message, message);
    }
  });

  it("requires the confirmation to match when one is supplied", () => {
    const mismatch = validatePassword("ValidPass1", "ValidPass2");
    assert.equal(mismatch.ok, false);
    assert.deepEqual(validatePassword("ValidPass1", "ValidPass1"), { ok: true });
  });

  it("rejects passwords longer than bcrypt's usable input", () => {
    const result = validatePassword(`Aa1${"x".repeat(200)}`);
    assert.equal(result.ok, false);
  });

  it("accepts a compliant password", () => {
    assert.deepEqual(validatePassword("Vyron2026!"), { ok: true });
  });
});

describe("temporary password generation", () => {
  it("always produces a password that satisfies the policy", () => {
    for (let i = 0; i < 500; i += 1) {
      const password = generateTemporaryPassword();
      const result = validatePassword(password, password);
      assert.equal(result.ok, true, `generated password failed policy: ${password}`);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) seen.add(generateTemporaryPassword());
    assert.equal(seen.size, 200);
  });

  it("honours a requested length within the supported bounds", () => {
    assert.equal(generateTemporaryPassword(24).length, 24);
    // Too short a request is raised to a safe floor rather than silently accepted.
    assert.ok(generateTemporaryPassword(4).length >= MIN_PASSWORD_LENGTH);
  });
});

describe("audit redaction", () => {
  it("removes anything password-shaped at any depth", () => {
    const redacted = redactSecrets({
      email: "user@example.com",
      password: "Sup3rSecret!",
      confirmPassword: "Sup3rSecret!",
      nested: { temporaryPassword: "Another1!", token: "abc", note: "keep me" },
      list: [{ userPassword: "Third1!" }, { keep: "yes" }],
    });

    const blob = JSON.stringify(redacted);
    assert.equal(blob.includes("Sup3rSecret!"), false);
    assert.equal(blob.includes("Another1!"), false);
    assert.equal(blob.includes("Third1!"), false);
    assert.equal(blob.includes("abc"), false);
    assert.ok(blob.includes("keep me"));
    assert.ok(blob.includes("user@example.com"));
  });

  it("keeps booleans so the fact of a credential change is still auditable", () => {
    const redacted = redactSecrets({ passwordApplied: true, mustChangePassword: false });
    assert.deepEqual(redacted, { passwordApplied: true, mustChangePassword: false });
  });

  it("passes ordinary values through untouched", () => {
    assert.equal(redactSecrets("plain"), "plain");
    assert.equal(redactSecrets(42), 42);
    assert.deepEqual(redactSecrets(["a", "b"]), ["a", "b"]);
  });
});
