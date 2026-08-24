/**
 * Server-authoritative idempotency for Road & Recovery mutations.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 *   Never execute a mutation because the CLIENT believes it has not run yet.
 *   The receipt in the database is the only authority.
 *
 * A device that has been offline cannot know whether its request reached the
 * server before the connection died. So it does not get to decide. It supplies
 * an operation id, and this module decides — from a row that either exists or
 * does not, adjudicated by a unique index that cannot lose a race.
 *
 * THE PROTOCOL
 *
 *   1. INSERT the receipt ... ON CONFLICT (company_id, operation_id) DO NOTHING
 *   2. 0 rows inserted -> the operation already exists.
 *        fingerprint matches   -> replay the stored result, execute NOTHING
 *        fingerprint differs   -> 409 OPERATION_CONFLICT
 *        still in progress     -> 409 (unless stale; see below)
 *   3. 1 row inserted -> we own it. Execute, then write the outcome back.
 *
 * WHY THE FINGERPRINT MATTERS. Without it, a client that reused an operation id
 * for a different payload would be handed the previous operation's result and
 * told it succeeded. That is worse than a duplicate: it is a silent wrong
 * answer. Same id + different body is never a legitimate retry.
 *
 * STALENESS. If the process dies between steps 1 and 3 the receipt is stranded
 * `in_progress`, and a naive implementation would refuse that operation forever.
 * A receipt older than STALE_AFTER_MS is treated as abandoned and reclaimed.
 *
 * OPTIONAL BY DESIGN. A request without an operationId behaves exactly as it did
 * before this module existed, so every route can adopt it independently and no
 * online path changes behaviour.
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Operation kinds the receipts table's CHECK constraint accepts (sql/095). */
export const RR_OPERATION_KINDS = [
  "transition",
  "accept_assignment",
  "decline_assignment",
  "capture_evidence",
  "add_note",
  "start_travel",
  "arrive",
  "complete",
] as const;

export type RrOperationKind = (typeof RR_OPERATION_KINDS)[number];

/**
 * How long an `in_progress` receipt is honoured before it is treated as
 * abandoned. Long enough that a slow-but-alive request is never stolen;
 * short enough that a driver is not locked out of retrying for long.
 */
export const RR_RECEIPT_STALE_AFTER_MS = 2 * 60 * 1000;

export type RrIdempotencyOutcome<T> =
  | { status: "executed"; result: T }
  | { status: "replayed"; result: T }
  | { status: "conflict"; code: "OPERATION_CONFLICT"; message: string }
  | { status: "in_progress"; code: "OPERATION_IN_PROGRESS"; message: string };

/**
 * Canonical JSON so the fingerprint is stable.
 *
 * Object key order must not change the hash — a client that serialises
 * `{a,b}` on one attempt and `{b,a}` on the next is making the SAME request,
 * and hashing the raw string would call that a conflict. Keys are sorted at
 * every depth; arrays keep their order because order is meaning there.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

/** sha256 of the canonicalised body, matching the column's CHECK format. */
export function fingerprintRequest(body: unknown): string {
  return createHash("sha256").update(canonicalise(body), "utf8").digest("hex");
}

/** A syntactically valid operation id, or null. Never trusted beyond its shape. */
export function readOperationId(value: unknown): string | null {
  const text = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)
    ? text
    : null;
}

type ReceiptRow = {
  id: string;
  status: string;
  result: unknown;
  request_fingerprint: string;
  created_at: string;
};

/**
 * Runs `execute` at most once for a given (company, operationId).
 *
 * `companyId` and `actorEmail` come from the already-verified request context —
 * never from the request body — so a receipt cannot be attributed to another
 * tenant or another user. The database's WITH CHECK enforces the same thing a
 * second time.
 */
export async function withIdempotency<T>(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    actorEmail: string;
    operationId: string;
    operationKind: RrOperationKind;
    serviceJobId?: string | null;
    requestBody: unknown;
  },
  execute: () => Promise<T>
): Promise<RrIdempotencyOutcome<T>> {
  const fingerprint = fingerprintRequest(input.requestBody);

  // Step 1 — claim the operation. The unique index is the arbiter: of two
  // concurrent retries exactly one insert succeeds, and it is not a race the
  // application can lose.
  const { data: claimed, error: claimError } = await supabase
    .from("rr_operation_receipts")
    .insert({
      company_id: input.companyId,
      operation_id: input.operationId,
      operation_kind: input.operationKind,
      service_job_id: input.serviceJobId || null,
      actor_email: input.actorEmail,
      request_fingerprint: fingerprint,
      status: "in_progress",
    })
    .select("id")
    .maybeSingle();

  const weOwnIt = Boolean(claimed?.id) && !claimError;

  if (!weOwnIt) {
    // Step 2 — somebody already claimed it. Decide from the STORED receipt.
    const { data: existingRow } = await supabase
      .from("rr_operation_receipts")
      .select("id,status,result,request_fingerprint,created_at")
      .eq("company_id", input.companyId)
      .eq("operation_id", input.operationId)
      .maybeSingle();

    const existing = existingRow as ReceiptRow | null;

    if (!existing) {
      // The insert failed for a reason other than the conflict (a constraint,
      // a permission). Fail closed rather than guess: executing here is exactly
      // the double-run this module prevents.
      return {
        status: "conflict",
        code: "OPERATION_CONFLICT",
        message: claimError?.message || "Could not record this operation.",
      };
    }

    if (existing.request_fingerprint !== fingerprint) {
      return {
        status: "conflict",
        code: "OPERATION_CONFLICT",
        message:
          "This operation id was already used for a different request. " +
          "Generate a new operation id rather than reusing one.",
      };
    }

    if (existing.status === "in_progress") {
      const age = Date.now() - new Date(existing.created_at).getTime();
      if (age < RR_RECEIPT_STALE_AFTER_MS) {
        return {
          status: "in_progress",
          code: "OPERATION_IN_PROGRESS",
          message: "This operation is already running. Retry shortly.",
        };
      }
      // Abandoned by a process that died mid-flight. Reclaim it — the row is
      // still ours to finish, and the fingerprint already matched.
      await supabase
        .from("rr_operation_receipts")
        .update({ status: "in_progress", error_message: null })
        .eq("id", existing.id);
      return finish(supabase, existing.id, execute, "executed");
    }

    // Terminal, same request: replay verbatim. Execute nothing.
    if (existing.status === "succeeded") {
      return { status: "replayed", result: existing.result as T };
    }

    // A previous attempt failed. Let this one try again under the same receipt.
    return finish(supabase, existing.id, execute, "executed");
  }

  // Step 3 — we own it.
  return finish(supabase, String(claimed!.id), execute, "executed");
}

/** Executes the work and records the outcome against the receipt. */
async function finish<T>(
  supabase: SupabaseClient,
  receiptId: string,
  execute: () => Promise<T>,
  status: "executed"
): Promise<RrIdempotencyOutcome<T>> {
  try {
    const result = await execute();
    await supabase
      .from("rr_operation_receipts")
      .update({
        status: "succeeded",
        result: (result ?? null) as never,
        completed_at: new Date().toISOString(),
      })
      .eq("id", receiptId);
    return { status, result };
  } catch (caught: unknown) {
    const message = caught instanceof Error ? caught.message : "Operation failed.";
    // Recorded as failed rather than left in progress, so the driver's next
    // retry is allowed through instead of being told it is still running.
    await supabase
      .from("rr_operation_receipts")
      .update({
        status: "failed",
        error_message: message.slice(0, 2000),
        completed_at: new Date().toISOString(),
      })
      .eq("id", receiptId);
    throw caught;
  }
}
