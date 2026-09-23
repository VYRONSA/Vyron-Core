import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SALES_EMAIL } from "@/lib/marketing/umora";
import {
  DuplicateGuard,
  LIMITS,
  MIN_FILL_MS,
  RateLimiter,
  enquiryEmailSubject,
  enquiryEmailText,
  validateEnquiry,
} from "@/lib/marketing/enquiry";

const NOW = 1_800_000_000_000;

function valid(overrides: Record<string, unknown> = {}) {
  return {
    name: "Thandi Mokoena",
    company: "Demo Retail Group",
    email: "thandi@example.co.za",
    phone: "+27 21 555 0100",
    employees: "240",
    message: "We run 14 branches and need attendance and payroll readiness under control.",
    consent: true,
    website: "",
    startedAt: NOW - 30_000,
    requestId: "req-1",
    ...overrides,
  };
}

describe("marketing enquiry validation", () => {
  it("accepts a complete enquiry and trims the values", () => {
    const result = validateEnquiry(valid({ name: "  Thandi Mokoena  " }), NOW);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.enquiry.name, "Thandi Mokoena");
      assert.equal(result.enquiry.email, "thandi@example.co.za");
      assert.equal(result.enquiry.requestId, "req-1");
    }
  });

  it("reports a field error for each missing or malformed field", () => {
    const cases: [Record<string, unknown>, keyof NonNullable<ReturnType<typeof errorsOf>>][] = [
      [{ name: "" }, "name"],
      [{ company: "" }, "company"],
      [{ email: "not-an-email" }, "email"],
      [{ email: "" }, "email"],
      [{ message: "too short" }, "message"],
      [{ consent: false }, "consent"],
      [{ phone: "0".repeat(LIMITS.phone.max + 1) }, "phone"],
    ];

    for (const [override, field] of cases) {
      const errors = errorsOf(validateEnquiry(valid(override), NOW));
      assert.ok(errors, `${field} case should be invalid`);
      assert.ok(errors[field], `expected an error on ${field}`);
    }
  });

  it("requires explicit consent", () => {
    for (const consent of [undefined, false, "true", 1]) {
      const errors = errorsOf(validateEnquiry(valid({ consent }), NOW));
      assert.ok(errors?.consent, `consent=${String(consent)} must be rejected`);
    }
  });

  it("rejects a filled honeypot as spam without leaking field errors", () => {
    const result = validateEnquiry(valid({ website: "http://spam.example" }), NOW);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "spam");
  });

  it("rejects submissions that arrive faster than a person could type, or from a stale form", () => {
    const instant = validateEnquiry(valid({ startedAt: NOW - (MIN_FILL_MS - 500) }), NOW);
    assert.equal(instant.ok, false);
    if (!instant.ok) assert.equal(instant.code, "spam");

    const stale = validateEnquiry(valid({ startedAt: NOW - 13 * 60 * 60 * 1000 }), NOW);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "spam");

    const missing = validateEnquiry(valid({ startedAt: undefined }), NOW);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "spam");
  });

  it("rejects over-long input", () => {
    const errors = errorsOf(validateEnquiry(valid({ message: "x".repeat(LIMITS.message.max + 1) }), NOW));
    assert.ok(errors?.message);
  });
});

describe("marketing enquiry rate limiting", () => {
  it("allows the first five submissions per key and then blocks", () => {
    const limiter = new RateLimiter(5, 10 * 60 * 1000);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(limiter.check("1.2.3.4", NOW), true, `submission ${i + 1} should pass`);
    }
    assert.equal(limiter.check("1.2.3.4", NOW), false);
    assert.equal(limiter.check("5.6.7.8", NOW), true, "a different caller is unaffected");
  });

  it("allows again once the window has passed", () => {
    const limiter = new RateLimiter(1, 1000);
    assert.equal(limiter.check("ip", NOW), true);
    assert.equal(limiter.check("ip", NOW + 500), false);
    assert.equal(limiter.check("ip", NOW + 1500), true);
  });
});

describe("marketing enquiry duplicate protection", () => {
  it("treats a repeated request id inside the window as already delivered", () => {
    const guard = new DuplicateGuard(10 * 60 * 1000);
    assert.equal(guard.seenBefore("req-1", NOW), false);
    guard.remember("req-1", NOW);
    assert.equal(guard.seenBefore("req-1", NOW + 1000), true);
    assert.equal(guard.seenBefore("req-2", NOW + 1000), false);
    assert.equal(guard.seenBefore("req-1", NOW + 11 * 60 * 1000), false, "expires after the window");
  });
});

describe("marketing enquiry email", () => {
  it("names the company in the subject and includes every submitted detail", () => {
    const result = validateEnquiry(valid(), NOW);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(enquiryEmailSubject(result.enquiry), "UMORA enquiry — Demo Retail Group");
    const body = enquiryEmailText(result.enquiry, new Date(NOW));
    for (const part of ["Thandi Mokoena", "Demo Retail Group", "thandi@example.co.za", "+27 21 555 0100", "240"]) {
      assert.ok(body.includes(part), `body should include ${part}`);
    }
    assert.ok(body.includes("agreed to be contacted"));
  });
});

function errorsOf(result: ReturnType<typeof validateEnquiry>) {
  return !result.ok && result.code === "invalid" ? result.errors : null;
}

describe("marketing enquiry destination", () => {
  it("always delivers to the VYRONSOFT sales inbox", () => {
    // The public site's enquiries go here unless UMORA_ENQUIRY_TO overrides it.
    // Pinned so a rebrand can never silently redirect customer enquiries.
    assert.equal(SALES_EMAIL, "info@vyronsoft.co.za");
  });
});
