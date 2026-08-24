import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalise,
  fingerprintRequest,
  readOperationId,
  withIdempotency,
  RR_RECEIPT_STALE_AFTER_MS,
} from "@/lib/road-recovery/idempotency";

/**
 * The offline protocol, tested as behaviour rather than shape.
 *
 * The double-execution these guard against is unrecoverable in production:
 * rr_service_state_events is append-only by trigger, so a duplicated transition
 * cannot be cleaned up afterwards.
 */

/** Minimal in-memory stand-in for the receipts table, including its unique index. */
function receiptStore(seed: Record<string, unknown>[] = []) {
  const rows: Record<string, unknown>[] = [...seed];
  let nextId = seed.length + 1;

  const client = {
    from() {
      const state: { filters: Record<string, unknown>; patch?: Record<string, unknown> } = {
        filters: {},
      };
      const builder: Record<string, unknown> = {
        insert(row: Record<string, unknown>) {
          const clash = rows.find(
            (r) => r.company_id === row.company_id && r.operation_id === row.operation_id
          );
          // The unique index, modelled: a clashing insert yields no row.
          if (clash) {
            (builder as { _inserted?: Record<string, unknown> | null })._inserted = null;
          } else {
            const created = { id: `r${nextId++}`, created_at: new Date().toISOString(), ...row };
            rows.push(created);
            (builder as { _inserted?: Record<string, unknown> | null })._inserted = created;
          }
          return builder;
        },
        update(patch: Record<string, unknown>) {
          state.patch = patch;
          return builder;
        },
        select: () => builder,
        eq(column: string, value: unknown) {
          state.filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          const inserted = (builder as { _inserted?: Record<string, unknown> | null })._inserted;
          if (inserted !== undefined) return { data: inserted, error: inserted ? null : { message: "duplicate" } };
          const found = rows.find((r) =>
            Object.entries(state.filters).every(([k, v]) => r[k] === v)
          );
          return { data: found ?? null, error: null };
        },
        then(resolve: (v: unknown) => unknown) {
          // Awaiting an update() applies the patch to every matching row.
          if (state.patch) {
            for (const row of rows) {
              if (Object.entries(state.filters).every(([k, v]) => row[k] === v)) {
                Object.assign(row, state.patch);
              }
            }
          }
          return Promise.resolve(resolve({ data: null, error: null }));
        },
      };
      return builder;
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, rows };
}

const BASE = {
  companyId: "c1",
  actorEmail: "driver@qa.invalid",
  operationId: "11111111-2222-4333-8444-555555555555",
  operationKind: "complete" as const,
  requestBody: { serviceJobId: "job-1", toState: "completed" },
};

describe("request fingerprinting", () => {
  it("is stable across key order — the same request must hash the same", () => {
    assert.equal(
      fingerprintRequest({ a: 1, b: { c: 2, d: 3 } }),
      fingerprintRequest({ b: { d: 3, c: 2 }, a: 1 })
    );
  });

  it("changes when a value changes", () => {
    assert.notEqual(fingerprintRequest({ toState: "completed" }), fingerprintRequest({ toState: "cancelled" }));
  });

  it("keeps array order significant", () => {
    assert.notEqual(canonicalise([1, 2]), canonicalise([2, 1]));
  });

  it("ignores undefined so an absent field and an explicit undefined agree", () => {
    assert.equal(canonicalise({ a: 1, b: undefined }), canonicalise({ a: 1 }));
  });

  it("produces the sha256 hex shape the column's CHECK requires", () => {
    assert.match(fingerprintRequest({ x: 1 }), /^[0-9a-f]{64}$/);
  });
});

describe("operation id validation", () => {
  it("accepts a v4 uuid and normalises case", () => {
    assert.equal(
      readOperationId("11111111-2222-4333-8444-555555555555".toUpperCase()),
      "11111111-2222-4333-8444-555555555555"
    );
  });
  it("rejects anything that is not one", () => {
    for (const bad of ["", "abc", "11111111-2222-3333-4444-555555555555", null, 42]) {
      assert.equal(readOperationId(bad), null, `accepted ${String(bad)}`);
    }
  });
});

describe("withIdempotency — the protocol", () => {
  it("executes once and reports it", async () => {
    const { client } = receiptStore();
    let runs = 0;
    const out = await withIdempotency(client, BASE, async () => { runs++; return { ok: true }; });
    assert.equal(out.status, "executed");
    assert.equal(runs, 1);
  });

  it("REPLAYS a completed operation without executing again", async () => {
    const { client } = receiptStore();
    let runs = 0;
    const work = async () => { runs++; return { ok: true, toState: "completed" }; };

    const first = await withIdempotency(client, BASE, work);
    const second = await withIdempotency(client, BASE, work);

    assert.equal(first.status, "executed");
    assert.equal(second.status, "replayed");
    assert.equal(runs, 1, "the mutation ran more than once");
    assert.deepEqual(
      second.status === "replayed" ? second.result : null,
      { ok: true, toState: "completed" },
      "the replay did not return the original result"
    );
  });

  it("refuses the same operation id with a DIFFERENT request", async () => {
    const { client } = receiptStore();
    let runs = 0;
    const work = async () => { runs++; return { ok: true }; };

    await withIdempotency(client, BASE, work);
    const conflict = await withIdempotency(
      client,
      { ...BASE, requestBody: { serviceJobId: "job-1", toState: "cancelled" } },
      work
    );

    assert.equal(conflict.status, "conflict");
    assert.equal(conflict.status === "conflict" ? conflict.code : null, "OPERATION_CONFLICT");
    assert.equal(runs, 1, "a conflicting retry executed the mutation");
  });

  it("does not execute twice when a retry lands mid-flight", async () => {
    const { client } = receiptStore([
      {
        id: "r1", company_id: "c1", operation_id: BASE.operationId,
        status: "in_progress", result: null,
        request_fingerprint: fingerprintRequest(BASE.requestBody),
        created_at: new Date().toISOString(),
      },
    ]);
    let runs = 0;
    const out = await withIdempotency(client, BASE, async () => { runs++; return { ok: true }; });
    assert.equal(out.status, "in_progress");
    assert.equal(runs, 0);
  });

  it("reclaims a receipt abandoned by a process that died", async () => {
    const stale = new Date(Date.now() - RR_RECEIPT_STALE_AFTER_MS - 1000).toISOString();
    const { client } = receiptStore([
      {
        id: "r1", company_id: "c1", operation_id: BASE.operationId,
        status: "in_progress", result: null,
        request_fingerprint: fingerprintRequest(BASE.requestBody),
        created_at: stale,
      },
    ]);
    let runs = 0;
    const out = await withIdempotency(client, BASE, async () => { runs++; return { ok: true }; });
    assert.equal(out.status, "executed");
    assert.equal(runs, 1, "a stale receipt permanently blocked the operation");
  });

  it("lets a retry through after a previous attempt failed", async () => {
    const { client } = receiptStore([
      {
        id: "r1", company_id: "c1", operation_id: BASE.operationId,
        status: "failed", result: null, error_message: "network",
        request_fingerprint: fingerprintRequest(BASE.requestBody),
        created_at: new Date().toISOString(),
      },
    ]);
    let runs = 0;
    const out = await withIdempotency(client, BASE, async () => { runs++; return { ok: true }; });
    assert.equal(out.status, "executed");
    assert.equal(runs, 1);
  });

  it("records a failure rather than stranding the receipt in progress", async () => {
    const { client, rows } = receiptStore();
    await assert.rejects(
      withIdempotency(client, BASE, async () => { throw new Error("boom"); }),
      /boom/
    );
    assert.equal(rows[0].status, "failed");
    assert.equal(rows[0].completed_at !== undefined, true);
  });

  it("attributes the receipt to the verified context, never the request body", async () => {
    const { client, rows } = receiptStore();
    await withIdempotency(
      client,
      { ...BASE, requestBody: { companyId: "someone-else", actorEmail: "attacker@evil.invalid" } },
      async () => ({ ok: true })
    );
    assert.equal(rows[0].company_id, "c1");
    assert.equal(rows[0].actor_email, "driver@qa.invalid");
  });
});
