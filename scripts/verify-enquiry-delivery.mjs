#!/usr/bin/env node
/**
 * UMORA — marketing enquiry delivery verification.
 *
 *   npm run verify:enquiry                          audit the configuration only
 *   npm run verify:enquiry -- --send                also deliver ONE test enquiry
 *   npm run verify:enquiry -- --staging --send      same, against a staging receiver
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS
 * ---------------------------------------------------------------------------
 *
 * The public contact form (app/api/marketing/enquiry) stores nothing: it hands the
 * enquiry to whichever delivery channel is configured, and only tells the visitor the
 * enquiry was received once that channel accepted it. So "is the contact form working"
 * is entirely a question about configuration, and this answers it.
 *
 * It FAILS CLOSED: anything it cannot confirm is a failure, never an assumption. It
 * never prints a secret — only whether one is present, and its length.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CHECKS
 * ---------------------------------------------------------------------------
 *
 *   1. Exactly one delivery channel is configured (webhook, or Resend email).
 *   2. The values are shaped correctly (https, a real sender address, a key that
 *      looks like a key).
 *   3. Nothing points at localhost, a private network or an obvious test endpoint —
 *      which is the mistake that silently loses production enquiries.
 *   4. With --send: one clearly-marked test enquiry is delivered end to end, and the
 *      run fails unless the channel actually accepted it.
 *
 * Run it against staging first. With --send it delivers a real message to whatever is
 * configured, so point it at a test webhook or a test inbox before using it in
 * production, and expect the message to arrive.
 */

const args = new Set(process.argv.slice(2));
const send = args.has("--send");
/**
 * Staging mode. Production rules still run, but "this points at a local or test
 * endpoint" drops from a failure to a warning, so the same script can verify a
 * staging deployment against a test receiver. Never use it to sign off production.
 */
const staging = args.has("--staging");

const webhookUrl = process.env.UMORA_ENQUIRY_WEBHOOK_URL?.trim() || "";
const webhookToken = process.env.UMORA_ENQUIRY_WEBHOOK_TOKEN?.trim() || "";
const resendKey = process.env.RESEND_API_KEY?.trim() || "";
const from = process.env.UMORA_ENQUIRY_FROM?.trim() || "";
const to = process.env.UMORA_ENQUIRY_TO?.trim() || "";

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
/** Fails in production mode; warns in staging mode. */
const failUnlessStaging = (msg) => {
  if (staging) console.log(`  warn  ${msg} (allowed: --staging)`);
  else fail(msg);
};
const pass = (msg) => console.log(`  ok    ${msg}`);
const note = (msg) => console.log(`        ${msg}`);

const secretShape = (value) => (value ? `present (${value.length} chars)` : "not set");

console.log(`\nUMORA enquiry delivery verification${staging ? " (staging mode — not valid for production sign-off)" : ""}\n`);

/* ---------------------------------------------- 1. a channel is configured */

const hasWebhook = Boolean(webhookUrl);
const hasResend = Boolean(resendKey && from);

console.log("Configuration");
note(`UMORA_ENQUIRY_WEBHOOK_URL   ${webhookUrl || "not set"}`);
note(`UMORA_ENQUIRY_WEBHOOK_TOKEN ${secretShape(webhookToken)}`);
note(`RESEND_API_KEY              ${secretShape(resendKey)}`);
note(`UMORA_ENQUIRY_FROM          ${from || "not set"}`);
note(`UMORA_ENQUIRY_TO            ${to || "not set (defaults to the sales address)"}`);
console.log("");

console.log("Checks");
if (!hasWebhook && !hasResend) {
  fail(
    "No delivery channel configured. Set UMORA_ENQUIRY_WEBHOOK_URL, or RESEND_API_KEY together with UMORA_ENQUIRY_FROM.",
  );
  note("Until one is set the endpoint returns 503 and the form shows the sales email address.");
} else if (hasWebhook && hasResend) {
  pass("A channel is configured.");
  note("Both channels are set; the webhook takes precedence and the Resend settings are ignored.");
} else {
  pass(`A channel is configured (${hasWebhook ? "webhook" : "Resend email"}).`);
}

/* --------------------------------------------------- 2 & 3. shape and targets */

const BAD_HOSTS = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/i;
const TEST_HINTS = /(ngrok|webhook\.site|requestbin|mocky|pipedream\.net|example\.com|test\.|\.test$|staging)/i;

if (hasWebhook) {
  let url;
  try {
    url = new URL(webhookUrl);
  } catch {
    fail("UMORA_ENQUIRY_WEBHOOK_URL is not a valid URL.");
  }
  if (url) {
    if (url.protocol !== "https:") failUnlessStaging(`Webhook must be https (found ${url.protocol}).`);
    else pass("Webhook uses https.");

    if (BAD_HOSTS.test(url.hostname)) failUnlessStaging(`Webhook points at a local or private address (${url.hostname}).`);
    else pass("Webhook is not a local or private address.");

    if (TEST_HINTS.test(url.hostname)) {
      failUnlessStaging(`Webhook host looks like a test endpoint (${url.hostname}). Fine for staging, wrong for production.`);
    } else {
      pass("Webhook host does not look like a test endpoint.");
    }

    if (!webhookToken) {
      note("No UMORA_ENQUIRY_WEBHOOK_TOKEN set — the receiving endpoint cannot authenticate the caller.");
    } else {
      pass("Webhook bearer token is set.");
    }
  }
}

if (hasResend) {
  if (!resendKey.startsWith("re_")) fail("RESEND_API_KEY does not look like a Resend key (expected it to start with re_).");
  else pass("Resend API key has the expected shape.");

  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) fail(`UMORA_ENQUIRY_FROM does not contain a valid address (${from}).`);
  else pass(`Sender address parses (${address}).`);

  if (TEST_HINTS.test(address)) failUnlessStaging(`Sender address looks like a test address (${address}).`);
  if (to && TEST_HINTS.test(to)) failUnlessStaging(`UMORA_ENQUIRY_TO looks like a test address (${to}).`);
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) fail(`UMORA_ENQUIRY_TO is not a valid address (${to}).`);
}

/* ------------------------------------------------------- 4. live delivery test */

if (send && failures === 0) {
  console.log("\nLive delivery test");
  const receivedAt = new Date();
  const enquiry = {
    name: "UMORA delivery test",
    company: "UMORA delivery test",
    email: "no-reply@vyronsoft.co.za",
    phone: "",
    employees: "",
    message:
      "This is an automated test of UMORA enquiry delivery (npm run verify:enquiry -- --send). No reply is needed.",
    requestId: `verify-${receivedAt.toISOString()}`,
  };

  try {
    let ok = false;
    if (hasWebhook) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
        },
        body: JSON.stringify({
          source: "umora-website",
          test: true,
          receivedAt: receivedAt.toISOString(),
          ...enquiry,
          consent: true,
        }),
        signal: AbortSignal.timeout(10000),
      });
      ok = response.ok;
      note(`Webhook responded ${response.status}.`);
    } else {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [to || "info@vyronsoft.co.za"],
          subject: "UMORA enquiry delivery test",
          text: enquiry.message,
        }),
        signal: AbortSignal.timeout(10000),
      });
      ok = response.ok;
      note(`Resend responded ${response.status}.`);
      if (!ok) note(`Body: ${(await response.text()).slice(0, 300)}`);
    }
    if (ok) pass("The configured channel accepted a test enquiry.");
    else fail("The configured channel did NOT accept the test enquiry.");
  } catch (error) {
    fail(`Delivery threw: ${error instanceof Error ? error.message : String(error)}`);
  }
} else if (send) {
  console.log("\nLive delivery test skipped — fix the configuration failures above first.");
} else {
  console.log("\nNo delivery attempted. Re-run with `-- --send` to deliver one test enquiry.");
}

console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures} problem${failures === 1 ? "" : "s"})`}\n`);
process.exit(failures === 0 ? 0 : 1);
