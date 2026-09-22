/**
 * Marketing enquiry validation, anti-spam and de-duplication.
 *
 * Kept free of Next.js and network code so the rules can be unit tested and so
 * the API route stays a thin shell. Nothing here writes to a database: public
 * enquiries are delivered to the sales inbox (see app/api/marketing/enquiry).
 */

export type EnquiryInput = {
  name?: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
  employees?: unknown;
  message?: unknown;
  consent?: unknown;
  /** Honeypot: must stay empty; real people never see this field. */
  website?: unknown;
  /** Epoch ms when the form was rendered, used to reject instant bot posts. */
  startedAt?: unknown;
  /** Stable per-submission id, used to collapse duplicate deliveries. */
  requestId?: unknown;
};

export type Enquiry = {
  name: string;
  company: string;
  email: string;
  phone: string;
  employees: string;
  message: string;
  requestId: string;
};

export type FieldErrors = Partial<Record<"name" | "company" | "email" | "phone" | "employees" | "message" | "consent", string>>;

export type ValidationResult =
  | { ok: true; enquiry: Enquiry }
  | { ok: false; code: "invalid"; errors: FieldErrors }
  | { ok: false; code: "spam" };

export const LIMITS = {
  name: { min: 2, max: 120 },
  company: { min: 2, max: 160 },
  email: { max: 254 },
  phone: { max: 40 },
  employees: { max: 20 },
  message: { min: 10, max: 4000 },
} as const;

/** Minimum time a human plausibly takes to fill the form. */
export const MIN_FILL_MS = 2500;
/** A start time older than this is treated as a stale or forged form. */
export const MAX_FORM_AGE_MS = 12 * 60 * 60 * 1000;

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateEnquiry(input: EnquiryInput, now = Date.now()): ValidationResult {
  // Anti-spam checks first: a bot submission is never reported back as a field error.
  if (text(input.website)) return { ok: false, code: "spam" };

  const startedAt = Number(input.startedAt);
  if (!Number.isFinite(startedAt)) return { ok: false, code: "spam" };
  const elapsed = now - startedAt;
  if (elapsed < MIN_FILL_MS || elapsed > MAX_FORM_AGE_MS) return { ok: false, code: "spam" };

  const name = text(input.name);
  const company = text(input.company);
  const email = text(input.email);
  const phone = text(input.phone);
  const employees = text(input.employees);
  const message = text(input.message);

  const errors: FieldErrors = {};
  if (name.length < LIMITS.name.min) errors.name = "Please enter your full name.";
  else if (name.length > LIMITS.name.max) errors.name = "That name is too long.";

  if (company.length < LIMITS.company.min) errors.company = "Please enter your company name.";
  else if (company.length > LIMITS.company.max) errors.company = "That company name is too long.";

  if (!email) errors.email = "Please enter your work email address.";
  else if (email.length > LIMITS.email.max || !EMAIL.test(email)) errors.email = "Please enter a valid email address.";

  if (phone && phone.length > LIMITS.phone.max) errors.phone = "That phone number is too long.";
  if (employees && employees.length > LIMITS.employees.max) errors.employees = "Please enter a number.";

  if (message.length < LIMITS.message.min) errors.message = "Please tell us a little about your operation.";
  else if (message.length > LIMITS.message.max) errors.message = "That message is too long.";

  if (input.consent !== true) errors.consent = "Please agree to us contacting you about your enquiry.";

  if (Object.keys(errors).length > 0) return { ok: false, code: "invalid", errors };

  const requestId = text(input.requestId).slice(0, 64) || `${startedAt}-${email}`;

  return { ok: true, enquiry: { name, company, email, phone, employees, message, requestId } };
}

/** Fixed-window limiter. Process-local: it survives only as long as the server instance. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  check(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      const recent = times.filter((at) => now - at < this.windowMs);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}

/** Remembers recently delivered submissions so a retry or double click sends once. */
export class DuplicateGuard {
  private seen = new Map<string, number>();
  private readonly windowMs: number;

  constructor(windowMs: number) {
    this.windowMs = windowMs;
  }

  /** True when this id was already delivered inside the window. */
  seenBefore(id: string, now = Date.now()): boolean {
    const at = this.seen.get(id);
    if (at !== undefined && now - at < this.windowMs) return true;
    return false;
  }

  remember(id: string, now = Date.now()) {
    this.seen.set(id, now);
    if (this.seen.size > 5000) {
      for (const [key, at] of this.seen) {
        if (now - at >= this.windowMs) this.seen.delete(key);
      }
    }
  }
}

export function enquiryEmailSubject(enquiry: Enquiry): string {
  return `UMORA enquiry — ${enquiry.company}`;
}

export function enquiryEmailText(enquiry: Enquiry, receivedAt: Date): string {
  return [
    "New UMORA website enquiry",
    "",
    `Name:      ${enquiry.name}`,
    `Company:   ${enquiry.company}`,
    `Email:     ${enquiry.email}`,
    `Phone:     ${enquiry.phone || "—"}`,
    `Employees: ${enquiry.employees || "—"}`,
    `Received:  ${receivedAt.toISOString()}`,
    "",
    "Message:",
    enquiry.message,
    "",
    "The sender agreed to be contacted about this enquiry.",
  ].join("\n");
}
