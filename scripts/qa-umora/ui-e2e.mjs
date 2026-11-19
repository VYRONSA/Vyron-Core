// Browser end-to-end checks against a LOCAL app (next dev on QA_APP_URL wired to the local
// Supabase replica). Requires Playwright + a Chromium build. Never point this at production.
// Usage: QA_APP_URL=http://localhost:3200 PLAYWRIGHT_REQUIRE=<path to a project with playwright>
//        CHROME_PATH=<chrome.exe> node scripts/qa-umora/ui-e2e.mjs <screenshot dir>
import { createRequire } from "module";
import { CEC, check, group, sql, summary } from "./lib.mjs";
import { USERS, seed } from "./seed.mjs";

const BASE = process.env.QA_APP_URL || "http://localhost:3200";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("UI tests run against a local app only.");
const require = createRequire(process.env.PLAYWRIGHT_REQUIRE || import.meta.url);
const { chromium } = require("playwright");
const OUT = process.argv[2] || ".";

const { employees: E } = await seed();
// QA_FAKE_CAMERA=1 emulates a tablet camera; without it the kiosk must still clock (no photo).
const fakeCamera = process.env.QA_FAKE_CAMERA === "1";
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: fakeCamera ? ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] : [],
});

const known = new Set();
async function session(email, viewport = { width: 1366, height: 900 }) {
  const context = await browser.newContext({
    viewport,
    geolocation: { latitude: -26.1076, longitude: 28.0567, accuracy: 15 },
    permissions: fakeCamera ? ["geolocation", "camera"] : ["geolocation"],
    timezoneId: "Africa/Johannesburg",
  });
  const page = await context.newPage();
  const failures = [];
  page.on("response", (r) => {
    if (r.status() < 400 || !/\/rest\/v1\//.test(r.url())) return;
    const what = `${r.status()} ${r.url().replace(/\?.*/, "").replace(/.*\/rest\/v1\//, "")}`;
    // Known and outside this remediation: the shell's hr_cases select deliberately probes a
    // newer column and falls back (400, then retries), and vyron_developer_workspaces does
    // not exist in production (Platform Console, separate work).
    if (/^400 hr_cases$|^404 vyron_developer_workspaces$|^404 vyron_product_packages$/.test(what)) known.add(what);
    else failures.push(what);
  });
  await page.goto(BASE + "/login", { timeout: 180000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "QaPass!2026x");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 });
  return { page, context, failures };
}

const bodyText = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

group("UI — kiosk clocking (manager-operated kiosk, kiosk mode)");
{
  const { page, failures } = await session(USERS.manager);
  await page.goto(BASE + "/clock?mode=kiosk", { timeout: 180000 });
  await page.getByText("Qa25 Cook", { exact: false }).first().click({ timeout: 120000 });
  const text0 = await bodyText(page);
  check("UI-01 kiosk mode hides the manager attendance tools", !text0.includes("Clocking & Attendance Excellence"), "panel hidden");
  await page.getByPlaceholder("Enter PIN before clocking").fill("0000");
  await page.getByRole("button", { name: /^Clock In$/ }).click();
  await page.waitForFunction(() => /Incorrect PIN/i.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
  check("UI-02 wrong PIN is refused on screen", /Incorrect PIN/i.test(await bodyText(page)), "incorrect PIN message shown");
  await page.getByPlaceholder("Enter PIN before clocking").fill("1025");
  await page.getByRole("button", { name: /^Clock In$/ }).click();
  await page.waitForFunction(() => /clocked in at/i.test(document.body.innerText), null, { timeout: 60000 });
  const rows = sql(`select count(*)||'|'||coalesce(max(gps_verification_status),'') from clock_events where employee_id='${E.CEC025}' and source='kiosk'`);
  check("UI-03 clock-in through the real screen is stored with GPS verified", rows.startsWith("1|within_radius"), rows);
  await page.waitForTimeout(1500);
  const text1 = await bodyText(page);
  check("UI-04 the screen now offers Clock Out", /Clock Out/.test(text1) && /Clocked In/.test(text1), "state updated");
  await page.screenshot({ path: `${OUT}/e2e-kiosk.png`, fullPage: false });
  check("UI-05 no data request failed on the kiosk", failures.length === 0, failures.join(", ") || "none");
}

group("UI — manager attendance panel and payroll prep");
{
  const { page, failures } = await session(USERS.manager);
  await page.goto(BASE + "/clock", { timeout: 180000 });
  await page.waitForFunction(() => document.body.innerText.includes("Clocking & Attendance Excellence"), null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  const t = await bodyText(page);
  check("UI-06 attendance panel loads without missing-table errors", !/Could not find the table/i.test(t), /Could not find the table[^.]*/i.exec(t)?.[0] || "loaded");
  check("UI-07 panel shows the real workforce (not 0)", /Employees\s*60\b|60\s*Active workforce/i.test(t), (t.match(/EMPLOYEES[^A-Z]{0,30}/i) || [""])[0]);
  await page.screenshot({ path: `${OUT}/e2e-attendance-panel.png`, fullPage: false });
  check("UI-08 no data request failed on the panel", failures.length === 0, failures.join(", ") || "none");

  const payroll = await session(USERS.payroll);
  await payroll.page.goto(BASE + "/dashboard", { timeout: 180000 });
  await payroll.page.waitForTimeout(5000);
  // Payroll Prep is not a sidebar item; it opens from the dashboard's "Payroll Readiness" card.
  const opened = await payroll.page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, a")].filter((el) => /View Details/i.test(el.textContent || ""));
    const target = buttons.find((el) => {
      let node = el.parentElement;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        if (/Payroll Readiness/i.test(node.textContent || "")) return true;
      }
      return false;
    });
    if (target) target.click();
    return Boolean(target);
  }).catch(() => false);
  if (opened) {
    await payroll.page.waitForFunction(() => /Generate|Export Approved Payroll CSV/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
    const pt = await bodyText(payroll.page);
    check("UI-09 Payroll Prep opens for a payroll user without errors",
      /Export Approved Payroll CSV/i.test(pt) && !/Could not find|permission denied/i.test(pt), "opened");
    await payroll.page.screenshot({ path: `${OUT}/e2e-payroll-prep.png`, fullPage: false });
  } else {
    check("UI-09 Payroll Prep reachable from the dashboard card", false, "card link not found");
  }
}

group("UI — dedicated kiosk device login");
{
  const { page, failures } = await session(USERS.kiosk);
  await page.goto(BASE + "/clock", { timeout: 180000 });
  await page.getByText("Qa22 Cook", { exact: false }).first().click({ timeout: 120000 });
  await page.waitForTimeout(3000);
  const before = await bodyText(page);
  check("UI-13 the kiosk device never shows manager tools (even without ?mode=kiosk)", !before.includes("Clocking & Attendance Excellence"), "panel hidden");
  await page.getByPlaceholder("Enter PIN before clocking").fill("1022");
  await page.getByRole("button", { name: /^Clock In$/ }).click();
  await page.waitForFunction(() => /clocked in at/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
  const stored = sql(`select count(*) from clock_events where employee_id='${E.CEC022}' and source='kiosk'`);
  check("UI-14 the kiosk device clocks an employee in with their PIN", stored === "1", `rows=${stored}`);
  await page.goto(BASE + "/payroll-readiness", { timeout: 180000 });
  await page.waitForTimeout(3000);
  check("UI-15 the kiosk device is kept out of manager pages", !page.url().includes("/payroll-readiness"), `landed on ${new URL(page.url()).pathname}`);
  check("UI-16 no data request failed on the kiosk device", failures.length === 0, failures.join(", ") || "none");
  await page.screenshot({ path: `${OUT}/e2e-kiosk-device.png`, fullPage: false });
}

group("UI — Company Master (Settings → Company) is preserved");
{
  const { page, failures } = await session(USERS.owner);
  await page.goto(BASE + "/dashboard", { timeout: 180000 });
  await page.waitForFunction(() => /Company Master/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
  check("UI-17 the owner sees the Company Master link", /Company Master/.test(await bodyText(page)), "link shown");
  await page.goto(BASE + "/settings/company", { timeout: 180000 });
  await page.waitForFunction(() => /Legal name/i.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const t = await bodyText(page);
  const legal = await page.locator("input").evaluateAll((els) => els.map((e) => e.value)).catch(() => []);
  check("UI-18 Settings → Company opens with the company's identity",
    page.url().includes("/settings/company") && /Legal name/i.test(t) && legal.includes("CEC QA (local replica)"),
    `at ${new URL(page.url()).pathname}; legal name field ${legal.includes("CEC QA (local replica)") ? "filled" : "MISSING"}`);
  await page.screenshot({ path: `${OUT}/e2e-company-master.png`, fullPage: false });
  check("UI-19 no data request failed on Company Master", failures.length === 0, failures.join(", ") || "none");

  const kioskDevice = await session(USERS.kiosk);
  await kioskDevice.page.goto(BASE + "/settings/company", { timeout: 180000 });
  await kioskDevice.page.waitForTimeout(3000);
  const kt = await bodyText(kioskDevice.page);
  check("UI-20 the kiosk device cannot open Company Master", !kioskDevice.page.url().includes("/settings/company") || !/Legal name/i.test(kt),
    `landed on ${new URL(kioskDevice.page.url()).pathname}`);
}

group("UI — employee on a phone");
{
  const { page, failures } = await session(USERS.employee1, { width: 390, height: 844 });
  await page.goto(BASE + "/staff-leave", { timeout: 180000 });
  await page.waitForTimeout(3000);
  check("UI-10 an employee is kept out of the manager leave console", !page.url().includes("/staff-leave"), `landed on ${new URL(page.url()).pathname}`);
  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  check("UI-11 no sideways scrolling on a 390 px screen", !hscroll, `horizontal overflow=${hscroll}`);
  check("UI-12 no data request failed for the employee", failures.filter((f) => !f.startsWith("401")).length === 0, failures.join(", ") || "none");
  await page.screenshot({ path: `${OUT}/e2e-employee-mobile.png`, fullPage: false });
}

await browser.close();
void CEC;
console.log("Known pre-existing request failures (not counted):", [...known].join(", ") || "none");
process.exit(summary() ? 1 : 0);
