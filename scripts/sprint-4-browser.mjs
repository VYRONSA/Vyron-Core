/**
 * Sprint 4 — browser QA via Playwright (headless).
 * Prereq: npm run dev running on http://localhost:3000
 * Usage: npx playwright@1.49.0 install chromium && node scripts/sprint-4-browser.mjs
 */

import { writeFileSync } from "fs";
import { resolve } from "path";

const REPORT_PATH = resolve(import.meta.dirname, "sprint-4-browser-report.json");
const BASE = process.env.VYRON_QA_BASE_URL || "http://localhost:3000";

const report = {
  timestamp: new Date().toISOString(),
  baseUrl: BASE,
  tests: {},
  note: "Camera/GPS prompts are mocked where possible; PIN kiosk needs test employee in session.",
};

function pass(name, detail = {}) {
  report.tests[name] = { ok: true, ...detail };
}
function fail(name, detail = {}) {
  report.tests[name] = { ok: false, ...detail };
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("playwright_available", { message: "Run: npx playwright@1.49.0 install chromium" });
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    geolocation: { latitude: -26.2041, longitude: 28.0473 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();

  try {
    // Clock page loads
    const clockRes = await page.goto(`${BASE}/clock`, { waitUntil: "domcontentloaded", timeout: 30000 });
    pass("clock_page_loads", { status: clockRes?.status() });

    const clockText = await page.textContent("body");
    const hasPinUi =
      clockText?.toLowerCase().includes("pin") ||
      clockText?.toLowerCase().includes("employee") ||
      clockText?.toLowerCase().includes("clock");
    hasPinUi ? pass("clock_pin_ui_present") : fail("clock_pin_ui_present", { snippet: clockText?.slice(0, 200) });

    // Leave kiosk
    const leaveRes = await page.goto(`${BASE}/leave`, { waitUntil: "domcontentloaded", timeout: 30000 });
    pass("leave_page_loads", { status: leaveRes?.status() });
    const leaveText = await page.textContent("body");
    leaveText?.toLowerCase().includes("leave")
      ? pass("leave_kiosk_ui_present")
      : fail("leave_kiosk_ui_present");

    // Main app shell (may redirect to login)
    const homeRes = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    pass("home_page_loads", { status: homeRes?.status() });
    const homeText = await page.textContent("body");
    const needsLogin =
      homeText?.toLowerCase().includes("sign in") ||
      homeText?.toLowerCase().includes("login") ||
      homeText?.toLowerCase().includes("password");
    if (needsLogin) {
      fail("authenticated_manager_flows", {
        message: "App requires login — configure VYRON_QA_EMAIL and VYRON_QA_PASSWORD for full MAC/employee tests",
      });
      fail("dashboard_empty_state", { message: "Requires authenticated session with new company" });
      fail("employee_create_edit", { message: "Requires login" });
    } else {
      pass("authenticated_shell_visible");
      const emptyState = homeText?.includes("Getting started") || homeText?.includes("No workforce data yet");
      emptyState ? pass("dashboard_empty_state") : fail("dashboard_empty_state", { message: "Empty state not visible — may have data or different company" });
    }

    fail("gps_prompt", { message: "Browser permission mock only — real device prompt not verified" });
    fail("camera_prompt", { message: "Headless browser cannot exercise camera capture" });
    fail("duplicate_clock_in_ui", { message: "Requires PIN-authenticated kiosk session with test employee" });
    fail("duplicate_clock_out_ui", { message: "Requires PIN-authenticated kiosk session" });
    fail("clock_refresh_persistence", { message: "Requires full kiosk flow" });
    fail("leave_approve_reject_cancel", { message: "Requires manager login" });
    fail("manager_action_centre", { message: "Requires manager login" });
  } catch (err) {
    fail("browser_run", { message: err.message });
  } finally {
    await browser.close();
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nReport: ${REPORT_PATH}`);

  const failed = Object.values(report.tests).filter((t) => t.ok === false);
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
