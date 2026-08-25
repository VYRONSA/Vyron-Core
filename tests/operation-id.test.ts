import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { newOperationId } from "@/lib/operation-id";

/**
 * Operation ids, tested where they actually broke.
 *
 * A phone loading the app over plain HTTP has no crypto.randomUUID, because
 * that API is gated behind a secure context. Browser QA never saw it: it runs
 * on localhost, which counts as secure. These tests therefore run the fallback
 * path deliberately rather than trusting whatever the test runtime happens to
 * provide.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Runs `fn` against a specific crypto implementation, then restores the real one. */
function withCrypto<T>(replacement: unknown, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    value: replacement,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(globalThis, "crypto", original);
    else delete (globalThis as { crypto?: unknown }).crypto;
  }
}

describe("operation ids", () => {
  it("uses randomUUID when the context is secure", () => {
    const stub = "11111111-2222-4333-8444-555555555555";
    const id = withCrypto({ randomUUID: () => stub }, () => newOperationId());
    assert.equal(id, stub);
  });

  it("still produces a valid v4 id where randomUUID does not exist", () => {
    // Exactly the shape of an Android WebView on an http:// origin.
    const insecure = {
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i += 1) a[i] = (i * 37 + 11) & 0xff;
        return a;
      },
    };
    const id = withCrypto(insecure, () => newOperationId());
    assert.match(id, UUID_V4, `${id} is not a v4 uuid`);
  });

  it("sets the version and variant bits rather than passing bytes through", () => {
    // All-zero bytes would produce an invalid uuid if the bits were not stamped.
    const zeros = { getRandomValues: (a: Uint8Array) => a.fill(0) };
    const id = withCrypto(zeros, () => newOperationId());
    assert.equal(id, "00000000-0000-4000-8000-000000000000");
    assert.match(id, UUID_V4);
  });

  it("does not repeat itself across many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5_000; i += 1) seen.add(newOperationId());
    assert.equal(seen.size, 5_000, "operation ids must not collide");
  });

  it("refuses to invent an id when there is no random source", () => {
    // Queueing work under a guessable key would risk merging two drivers'
    // actions, so refusing is the correct outcome.
    assert.throws(
      () => withCrypto({}, () => newOperationId()),
      /cannot create an operation id/i
    );
  });
});
