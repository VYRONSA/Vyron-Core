/**
 * Operation identifiers for the offline queues.
 *
 * WHY THIS EXISTS INSTEAD OF CALLING crypto.randomUUID() DIRECTLY
 *
 *   `crypto.randomUUID` is only exposed in a **secure context**. HTTPS pages
 *   and localhost qualify; a page served over plain HTTP from any other host
 *   does not, and there the property is simply `undefined`. A driver's phone
 *   pointed at an http:// origin therefore hit "crypto.randomUUID is not a
 *   function" the moment they tried to report an incident — the whole reporter
 *   crashed, and the one screen that must never fail is the safety one.
 *
 *   It went unnoticed for so long because browser QA runs against
 *   http://127.0.0.1, and localhost IS a secure context. The API existed in
 *   every test and vanished on the first real device.
 *
 * WHY THE FALLBACK IS getRandomValues AND NOT Math.random
 *
 *   These identifiers are idempotency keys. The server stores one receipt per
 *   (company, operation) and replays anything it has already executed, so a
 *   collision would silently merge two different pieces of a driver's work —
 *   an arrival recorded once for two separate jobs, evidence attached to the
 *   wrong incident. `Math.random` is not collision-resistant and is not seeded
 *   from a cryptographic source, so it is not an acceptable source here.
 *
 *   `crypto.getRandomValues` carries no secure-context requirement, so it is
 *   available exactly where `randomUUID` is not. If neither exists we throw
 *   rather than invent an id: refusing to queue work is recoverable, quietly
 *   queueing it under a key that might collide is not.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export function newOperationId(): string {
  const webcrypto = globalThis.crypto;

  if (typeof webcrypto?.randomUUID === "function") {
    return webcrypto.randomUUID();
  }

  if (typeof webcrypto?.getRandomValues === "function") {
    const bytes = webcrypto.getRandomValues(new Uint8Array(16));
    // RFC 4122: version 4 in the high nibble of byte 6, variant 10 in byte 8.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => HEX[b]).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error(
    "No cryptographic random source is available, so this device cannot create " +
      "an operation id. Queueing work without one risks duplicating it."
  );
}
