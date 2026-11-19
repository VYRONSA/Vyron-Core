/**
 * Company Master — structural and behavioural invariants.
 *
 * Two kinds of assertion here, and the distinction matters.
 *
 *   BEHAVIOURAL  the pure client-side rules: which fields may be sent, how a
 *                refusal is reported, how validation behaves. These run in
 *                process against the real functions.
 *
 *   STRUCTURAL   properties of the SOURCE that no request-level test would
 *                catch on a NEW screen: that nothing reads or writes
 *                public.companies directly, that authority is never inferred
 *                from a module role, that the migration leaves the HR/payroll
 *                tenancy spine alone. A regression here would be introduced by
 *                the next person to touch the file, not by these ones.
 *
 * The authenticated end-to-end matrix - grant, revoke, cross-company denial,
 * the HR/payroll firewall - is not reproduced here. It cannot be honestly
 * simulated in-process, because every one of those outcomes is decided by RLS
 * against a real auth.uid(). It lives in sql/qa/098-company-master-tests.sql
 * and was executed against a controlled database and against production.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  EDITABLE_COMPANY_FIELDS,
  PLATFORM_CONTROLLED_FIELDS,
  COMPANY_BRANDING_BUCKET,
  candidateLabel,
  validateCompanyField,
} from "../lib/company-master";
import {
  canAccessRouteForRole,
  normalizeRbacRole,
} from "../lib/server/auth-routing";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

const LIB = read("lib/company-master.ts");
const PANEL = read("components/settings/CompanyMasterPanel.tsx");
const PAGE = read("app/(app)/settings/company/page.tsx");
const MIGRATION = read("sql/098-vyron-company-master.sql");
const DIRECTORY = read("sql/099-company-master-user-directory.sql");
const DIRECTORY_ROLLBACK = read("sql/099-rollback.sql");
const SHELL = read("app/_app-shell.tsx");
const NAV_HOOK = read("lib/use-company-master.ts");

/** SQL with -- comments and block comments removed, so prose cannot satisfy a check. */
const sqlCode = MIGRATION
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");

/**
 * Code with string literals collapsed as well.
 *
 * The migration names vyron_user_company_ids() inside COMMENT ON ... IS '...'
 * to record why it is left alone. That is documentation, not a reference the
 * database executes, and a check for "does this code touch the spine" must not
 * trip over the sentence explaining that it does not.
 */
const sqlExecutable = sqlCode.replace(/'(?:[^']|'')*'/g, "''");

/** The same two treatments for sql/099. */
const dirCode = DIRECTORY
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");
const dirExecutable = dirCode.replace(/'(?:[^']|'')*'/g, "''");

/**
 * TypeScript source with comments removed.
 *
 * Structural checks look for patterns that must not appear in CODE. The
 * files here document why those patterns are wrong - naming them in prose to
 * explain the rule - so a check run against the raw text finds the
 * explanation and reports the very thing it was written to prevent.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const SHELL_CODE = codeOnly(SHELL);
const PAGE_CODE = codeOnly(PAGE);
const PANEL_CODE = codeOnly(PANEL);
const LIB_CODE = codeOnly(LIB);

/* ================================================================== */
/* 1 + 2. The authorised user can read and edit                       */
/* ================================================================== */

describe("Company Master — reads and writes go through the 098 functions", () => {
  it("reads identity through vyron_get_company", () => {
    assert.match(LIB, /rpc\("vyron_get_company"/);
  });

  it("writes identity through vyron_update_company", () => {
    assert.match(LIB, /rpc\("vyron_update_company"/);
  });

  it("resolves visibility and authority through the two tenancy functions", () => {
    assert.match(LIB, /rpc\("vyron_company_directory_ids"\)/);
    assert.match(LIB, /rpc\("vyron_company_admin_ids"\)/);
  });

  it("never touches public.companies directly from client code", () => {
    const files = [["lib", LIB_CODE], ["panel", PANEL_CODE], ["page", PAGE_CODE]] as const;
    for (const [name, src] of files) {
      assert.doesNotMatch(src, /\.from\(\s*["'`]companies["'`]\s*\)/,
        `${name} reads or writes public.companies directly`);
    }
  });

  it("never touches the grant table directly - it is closed to clients", () => {
    for (const src of [LIB_CODE, PANEL_CODE, PAGE_CODE]) {
      assert.doesNotMatch(src, /\.from\(\s*["'`]vyron_company_master_admins["'`]\s*\)/);
    }
  });
});

/* ================================================================== */
/* 3. An edit is only reported as saved when the server agrees        */
/* ================================================================== */

describe("Company Master — persistence is verified, not assumed", () => {
  it("re-reads the record after a successful save", () => {
    const save = PANEL.slice(PANEL.indexOf("async function save()"), PANEL.indexOf("async function onLogo"));
    assert.ok(
      save.indexOf("updateCompanyMaster") < save.indexOf("getCompanyMaster"),
      "the panel must read the record back before claiming a save succeeded",
    );
  });

  it("reports success only when the server returns ok", () => {
    assert.match(PANEL, /if \(!res\.ok\)/);
    assert.match(PANEL, /setSaved\(/);
  });

  it("surfaces refused fields instead of folding them into a success", () => {
    assert.match(PANEL, /setRejected\(res\.rejected\)/);
    assert.match(PANEL, /The server refused/);
  });

  it("an orphaned logo object is removed when the record cannot be linked", () => {
    const upload = LIB.slice(LIB.indexOf("export async function uploadCompanyLogo"));
    assert.ok(
      upload.indexOf(".remove([path])") > upload.indexOf("if (!linked.ok)"),
      "a stored file nothing refers to must be cleaned up",
    );
  });
});

/* ================================================================== */
/* 4 + 5. Authority is explicit, never inferred                       */
/* ================================================================== */

describe("Company Master — authority is never inferred from a module role", () => {
  it("no client file consults Safety, HR or payroll membership for authority", () => {
    const files = [["lib", LIB_CODE], ["panel", PANEL_CODE], ["page", PAGE_CODE]] as const;
    for (const [name, src] of files) {
      assert.doesNotMatch(src, /safety_user_access/, `${name} reads Safety access`);
      assert.doesNotMatch(src, /company_users/, `${name} reads CORE membership`);
      assert.doesNotMatch(src, /\bpayroll_|\bemployees\b/i, `${name} consults HR/payroll`);
    }
  });

  it("the migration's authority function reads no module grant table", () => {
    const fn = sqlCode.slice(
      sqlCode.indexOf("CREATE OR REPLACE FUNCTION public.vyron_company_admin_ids"),
      sqlCode.indexOf("COMMENT ON FUNCTION public.vyron_company_admin_ids"),
    );
    assert.ok(fn.length > 0, "vyron_company_admin_ids() not found");
    assert.doesNotMatch(fn, /safety_user_access/,
      "a Safety role must not confer Company Master authority");
    assert.match(fn, /vyron_company_master_admins/);
    assert.match(fn, /cma\.status = 'active'/);
  });

  it("an unauthorised user is shown a read-only state, not a form that will fail", () => {
    assert.match(PANEL, /const readOnly = !company\.can_edit \|\| !editing/);
    assert.match(PANEL, /Read only/);
    assert.match(PANEL, /You can see this company/);
  });

  it("can_edit only gates rendering; every mutation still goes to an RPC", () => {
    /* The flag decides what is DRAWN. It must not be the thing that decides
       whether a write happens - that is the RPC's job, and it re-checks. */
    assert.match(PANEL_CODE, /can_edit \|\| !editing/,
      "can_edit should feed the readOnly rendering decision");
    for (const call of ["updateCompanyMaster", "grantCompanyMasterAdmin",
      "revokeCompanyMasterAdmin", "uploadCompanyLogo"]) {
      assert.ok(PANEL_CODE.includes(call), `${call} must be reached through the data layer`);
    }
    /* And no mutation may be guarded ONLY by the flag: the panel never calls
       supabase directly, so there is no path that skips the RPC. */
    assert.doesNotMatch(PANEL_CODE, /getSupabaseBrowserClient/,
      "the panel must go through lib/company-master.ts, not straight to supabase");
  });
});

/* ================================================================== */
/* 6. Grant and revoke                                                */
/* ================================================================== */

describe("Company Master — grant and revoke", () => {
  it("both go through the audited RPCs", () => {
    assert.match(LIB, /rpc\("vyron_grant_company_master_admin"/);
    assert.match(LIB, /rpc\("vyron_revoke_company_master_admin"/);
  });

  it("the administrator list is only offered when the server permits it", () => {
    assert.match(PANEL, /company\.can_manage_admins &&/);
  });

  it("both operations are audited in the migration", () => {
    assert.match(sqlCode, /'company_master_admin\.granted'/);
    assert.match(sqlCode, /'company_master_admin\.revoked'/);
  });

  it("revocation marks the row rather than deleting it", () => {
    const fn = sqlCode.slice(sqlCode.indexOf("FUNCTION public.vyron_revoke_company_master_admin"));
    assert.match(fn, /SET status\s+= 'revoked'/);
    assert.doesNotMatch(fn, /DELETE FROM public\.vyron_company_master_admins/);
  });
});

/* ================================================================== */
/* 7. CORE membership is never fabricated                             */
/* ================================================================== */

describe("Company Master — company_users is never written", () => {
  it("no client file inserts CORE membership", () => {
    for (const src of [LIB_CODE, PANEL_CODE, PAGE_CODE]) {
      assert.doesNotMatch(src, /company_users/);
    }
  });

  it("the grant function creates no company_users row", () => {
    const fn = sqlCode.slice(
      sqlCode.indexOf("FUNCTION public.vyron_grant_company_master_admin"),
      sqlCode.indexOf("FUNCTION public.vyron_revoke_company_master_admin"),
    );
    assert.doesNotMatch(fn, /INSERT INTO public\.company_users/);
  });
});

/* ================================================================== */
/* 8. Platform-controlled fields                                      */
/* ================================================================== */

describe("Company Master — platform-controlled fields are unreachable", () => {
  it("none of them is in the editable set", () => {
    for (const f of PLATFORM_CONTROLLED_FIELDS) {
      assert.ok(!(EDITABLE_COMPANY_FIELDS as readonly string[]).includes(f),
        `${f} must not be editable`);
    }
  });

  it("none of them is rendered as an input", () => {
    for (const f of PLATFORM_CONTROLLED_FIELDS) {
      assert.doesNotMatch(PANEL, new RegExp(`key:\\s*["']${f}["']`),
        `${f} must not appear as a form field`);
    }
  });

  it("the client sends only whitelisted keys", async () => {
    /* updateCompanyMaster filters the patch before it leaves the browser. The
       database refuses them anyway - this is belt as well as braces. */
    const fn = LIB.slice(LIB.indexOf("export async function updateCompanyMaster"));
    assert.match(fn, /for \(const key of EDITABLE_COMPANY_FIELDS\)/);
    assert.match(fn, /if \(key in patch\) clean\[key\] = patch\[key\] \?\? null/);
  });

  it("the migration's whitelist excludes every platform-controlled column", () => {
    const upd = sqlCode.slice(sqlCode.indexOf("FUNCTION public.vyron_update_company"));
    const whitelist = upd.slice(upd.indexOf("editable   constant"), upd.indexOf("];"));
    for (const f of PLATFORM_CONTROLLED_FIELDS) {
      assert.doesNotMatch(whitelist, new RegExp(`'${f}'`), `${f} is in the SQL whitelist`);
    }
  });

  it("the two whitelists agree", () => {
    const upd = sqlCode.slice(sqlCode.indexOf("FUNCTION public.vyron_update_company"));
    const whitelist = upd.slice(upd.indexOf("editable   constant"), upd.indexOf("];"));
    for (const f of EDITABLE_COMPANY_FIELDS) {
      assert.match(whitelist, new RegExp(`'${f}'`),
        `${f} is editable in the client but not in the database`);
    }
  });
});

/* ================================================================== */
/* 9. Cross-company                                                   */
/* ================================================================== */

describe("Company Master — tenant isolation", () => {
  it("the company is chosen from the directory, never by position", () => {
    assert.match(PAGE, /listVisibleCompanyIds/);
    /* One visible company may be selected automatically; that is not
       "assume the first", it is "there is only one". Any OTHER indexed
       access would be. */
    assert.match(PAGE, /if \(named\.length === 1\) setSelected\(named\[0\]\.id\)/);
    const indexed = PAGE_CODE.match(/\w+\[0\]/g) ?? [];
    assert.equal(indexed.length, 1,
      `expected exactly one guarded [0] access, found ${indexed.length}`);
    assert.match(PAGE, /never from a position in a list/);
  });

  it("more than one visible company forces an explicit choice", () => {
    assert.match(PAGE, /choices\.length > 1/);
    assert.match(PAGE, /Choose a company/);
  });

  it("every RPC is scoped by an explicit company id", () => {
    for (const call of ["vyron_get_company", "vyron_update_company",
      "vyron_list_company_master_admins", "vyron_grant_company_master_admin",
      "vyron_revoke_company_master_admin"]) {
      const at = LIB.indexOf(`rpc("${call}"`);
      assert.ok(at > 0, `${call} is not called`);
      assert.match(LIB.slice(at, at + 220), /p_company_id/,
        `${call} must be scoped by company id`);
    }
  });

  it("the migration refuses a logo path belonging to another company", () => {
    const upd = sqlCode.slice(sqlCode.indexOf("FUNCTION public.vyron_update_company"));
    assert.match(upd, /split_part\([^)]*\) <> p_company_id::text/);
    assert.match(upd, /LIKE '%\.\.%'/);
  });
});

/* ================================================================== */
/* The invariants the whole design rests on                           */
/* ================================================================== */

describe("Company Master — the untouchable boundaries", () => {
  it("the migration never modifies the HR/payroll tenancy spine", () => {
    const refs = sqlExecutable.split("\n").filter((l) => l.includes("vyron_user_company_ids"));
    assert.equal(refs.length, 0,
      "vyron_user_company_ids() gates 82 policies across 75 tables and must stay untouched");
  });

  it("the migration adds no policy to public.companies", () => {
    assert.doesNotMatch(sqlCode, /CREATE\s+POLICY[^;]*ON\s+public\.companies/i);
  });

  it("the migration alters no HR, payroll or Safety object", () => {
    assert.doesNotMatch(sqlCode, /ALTER\s+TABLE\s+public\.(employees|hr_|payroll_|leave_|clock_)/i);
    assert.doesNotMatch(sqlCode, /(ALTER|DROP|CREATE)\s+(TABLE|POLICY)[^;]*safety_/i);
  });

  it("the grant table is closed to clients twice over", () => {
    assert.match(sqlCode, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sqlCode, /REVOKE ALL ON TABLE public\.vyron_company_master_admins FROM anon/);
    assert.match(sqlCode, /REVOKE ALL ON TABLE public\.vyron_company_master_admins FROM authenticated/);
    assert.doesNotMatch(sqlCode, /CREATE POLICY[^;]*ON public\.vyron_company_master_admins/i);
  });

  it("branding is private and served by signed URL only", () => {
    assert.match(sqlCode, /'company-branding', 'company-branding', false/);
    assert.match(LIB, /createSignedUrl/);
    assert.doesNotMatch(LIB, /getPublicUrl/);
    assert.equal(COMPANY_BRANDING_BUCKET, "company-branding");
  });
});

/* ================================================================== */
/* Validation                                                         */
/* ================================================================== */

describe("Company Master — client validation mirrors the server", () => {
  it("requires a legal name", () => {
    assert.match(String(validateCompanyField("name", "   ")), /required/);
    assert.equal(validateCompanyField("name", "HSE Insight (Pty) Ltd"), null);
  });

  it("bounds the legal name", () => {
    assert.match(String(validateCompanyField("name", "x".repeat(201))), /too long/);
  });

  it("checks the email shape", () => {
    assert.equal(validateCompanyField("email", "info@hseinsight.co.za"), null);
    assert.match(String(validateCompanyField("email", "not-an-address")), /valid email/);
  });

  it("requires a scheme on the website", () => {
    assert.equal(validateCompanyField("website", "https://hseinsight.co.za"), null);
    assert.match(String(validateCompanyField("website", "hseinsight.co.za")), /http/);
  });

  it("applies the South African VAT format only to South African companies", () => {
    assert.equal(validateCompanyField("vat_number", "4123456789", "South Africa"), null);
    assert.match(String(validateCompanyField("vat_number", "123", "South Africa")),
      /10 digits beginning with 4/);
    /* VYRON is intended to operate in more than one country. */
    assert.equal(validateCompanyField("vat_number", "GB123456789", "United Kingdom"), null);
  });

  it("lets an optional field be cleared", () => {
    for (const f of ["trading_name", "email", "website", "vat_number"] as const) {
      assert.equal(validateCompanyField(f, ""), null, `${f} should be clearable`);
    }
  });
});

/* ================================================================== */
/* 10. Navigation — the route is offered, not just routable            */
/* ================================================================== */

describe("Company Master — navigation", () => {
  it("the CORE shell links to /settings/company", () => {
    assert.match(SHELL_CODE, /href="\/settings\/company"/,
      "the sidebar must offer the Company Master route");
  });

  it("the entry is labelled Company Master", () => {
    assert.match(SHELL_CODE, /Company Master<\/span>/,
      "the sidebar entry must say what it is");
    assert.match(SHELL_CODE, /label: "Company Master"/,
      "the mobile drawer entry must carry the same label");
  });

  it("mobile and desktop offer the same route", () => {
    /* Two navigations that disagree about what exists is how a feature ends up
       reachable on one device and invisible on another. */
    assert.match(SHELL_CODE, /router\.push\("\/settings\/company"\)/);
  });

  it("reuses the existing standalone-route pattern rather than a new system", () => {
    /* Platform Console and Road & Recovery are already linked this way. The
       Company Master link must be a sibling of those, not a second mechanism:
       no new nav group, and no new entry in the setActive() alias map. */
    assert.doesNotMatch(SHELL_CODE, /"Company Master":/,
      "Company Master must not be added to the setActive alias map - it is a route");
    assert.doesNotMatch(SHELL_CODE, /active === "Company Master"/,
      "Company Master must not become an in-shell screen; it is a route");
  });

  it("visibility is a display gate, never the authority", () => {
    assert.match(SHELL_CODE, /companyMasterVisible \|\| platformOperator/,
      "the sidebar gate must OR in the platform operator, as the 098 callers do");
    assert.match(NAV_HOOK, /listVisibleCompanyIds/,
      "the gate must come from the company directory");
  });

  it("the nav gate is not a CORE or module role check", () => {
    /* A Company Master administrator may hold no company_users row at all.
       Gating the link on CORE membership would hide the screen from exactly
       the person sql/098 was built for. */
    for (const forbidden of ["company_users", "safety_user_access", "vyron_user_company_ids"]) {
      assert.ok(!codeOnly(NAV_HOOK).includes(forbidden),
        `the navigation gate must not consult ${forbidden}`);
    }
  });

  it("the gate failing hides the link rather than inventing access", () => {
    assert.match(NAV_HOOK, /setVisible\(false\)/,
      "a failed lookup must not leave the entry showing as if it were resolved");
  });

  it("the offer agrees with what middleware will actually allow", () => {
    /* Behavioural, against the same function middleware.ts enforces with.
       /settings is closed to supervisors and employees, so a link offered to
       them would bounce to /dashboard instead of opening. */
    assert.equal(canAccessRouteForRole("owner", "/settings/company"), true);
    assert.equal(canAccessRouteForRole("platform_operator", "/settings/company"), true);
    assert.equal(canAccessRouteForRole(normalizeRbacRole("admin"), "/settings/company"), true);
    assert.equal(canAccessRouteForRole("supervisor", "/settings/company"), false);
    assert.equal(canAccessRouteForRole("employee", "/settings/company"), false);
  });

  it("the shell asks that same question before offering the link", () => {
    const offers = SHELL_CODE.match(
      /canAccessRouteForRole\(normalizeRbacRole\([a-zA-Z]+\), "\/settings\/company"\)/g) ?? [];
    assert.equal(offers.length, 2,
      "both the sidebar and the mobile drawer must apply the route check");
  });

  it("the route check narrows the offer, it never widens it", () => {
    /* The role test is ANDed with directory visibility. If it were OR'd, a CORE
       owner with no company in the directory would be offered the screen. */
    assert.match(SHELL_CODE,
      /\(companyMasterVisible \|\| platformOperator\)\s*&&\s*canAccessRouteForRole/);
    assert.match(SHELL_CODE,
      /\(companyMasterVisible \|\| platformOperatorSession\)\s*&&\s*canAccessRouteForRole/);
  });
});

/* ================================================================== */
/* 11. The administrator selector                                      */
/* ================================================================== */

describe("Company Master — administrators are chosen, not typed", () => {
  it("the panel offers a select built from the server's candidate list", () => {
    assert.match(PANEL_CODE, /grantableCandidates\.map/,
      "the options must come from the candidate list");
    assert.match(PANEL_CODE, /listCompanyMasterCandidates/);
  });

  it("the primary grant path cannot receive a hand-typed UUID", () => {
    /* grantChoice is only ever set from a <select> whose values are server
       supplied. There must be no input element writing it. */
    assert.match(PANEL_CODE, /onChange=\{\(e\) => setGrantChoice\(e\.target\.value\)\}/);
    const selectSetters = PANEL_CODE.match(/setGrantChoice\(/g) ?? [];
    /* Set from the select, and cleared after a successful grant. Nothing else. */
    assert.ok(selectSetters.length <= 3,
      `setGrantChoice should have very few writers, found ${selectSetters.length}`);
    assert.doesNotMatch(PANEL_CODE, /<input[^>]*setGrantChoice/);
  });

  it("the UUID field survives only as an explicitly-labelled pre-099 fallback", () => {
    /* Removing it outright would break every database where sql/099 is not yet
       applied - production included, until it is. It must be unreachable
       whenever the directory lookup answers. */
    assert.match(PANEL_CODE, /directoryAvailable === false/);
    assert.match(PANEL_CODE, /directoryAvailable === true/);
    const fallback = PANEL_CODE.slice(PANEL_CODE.indexOf("directoryAvailable === false"));
    assert.match(fallback, /setGrantId/,
      "the UUID entry must sit inside the unavailable branch");
  });

  it("an unavailable lookup is distinguished from an empty company", () => {
    /* Collapsing the two would show an empty dropdown and quietly remove the
       ability to grant, with nothing on screen explaining why. */
    assert.match(LIB_CODE, /available: false/);
    assert.match(LIB_CODE, /PGRST202/);
    assert.match(LIB_CODE, /isMissingFunction/);
  });

  it("a missing function is not confused with a refusal", () => {
    /* isMissingFunction must key on the PostgREST code, so a 403 keeps
       surfacing as a refusal instead of offering the UUID box to someone who
       is simply not allowed to see the directory. */
    const fn = LIB_CODE.slice(LIB_CODE.indexOf("function isMissingFunction"));
    assert.match(fn, /error\.code === "PGRST202"/);
    assert.doesNotMatch(fn.slice(0, 400), /42501|permission|denied/i);
  });

  it("every grant still goes through the 098 RPCs", () => {
    assert.match(LIB_CODE, /rpc\("vyron_grant_company_master_admin"/);
    assert.match(LIB_CODE, /rpc\("vyron_grant_company_master_admin_by_email"/);
    assert.match(LIB_CODE, /rpc\("vyron_revoke_company_master_admin"/);
    /* And the panel never reaches the database itself. */
    assert.doesNotMatch(PANEL_CODE, /getSupabaseBrowserClient/);
    assert.doesNotMatch(PANEL_CODE, /\.from\(/);
  });

  it("somebody who already holds the grant is not offered it again", () => {
    assert.match(PANEL_CODE, /!c\.is_admin/);
  });

  it("a person is labelled by identity, with the uuid still shown", () => {
    assert.equal(
      candidateLabel({ auth_user_id: "u1", email: "a@b.co", display_name: "Ada Lovelace", sources: ["core"], is_admin: false }),
      "Ada Lovelace — a@b.co");
    assert.equal(
      candidateLabel({ auth_user_id: "u1", email: "a@b.co", display_name: null, sources: ["core"], is_admin: false }),
      "a@b.co");
    assert.equal(
      candidateLabel({ auth_user_id: "u1", email: null, display_name: "Ada", sources: ["core"], is_admin: false }),
      "Ada");
    /* Never an empty option: an unlabelled row is one nobody can choose. */
    assert.equal(
      candidateLabel({ auth_user_id: "u1", email: null, display_name: null, sources: ["core"], is_admin: false }),
      "u1");
    assert.match(PANEL_CODE, /\{a\.auth_user_id\}/,
      "the admin list must keep showing the uuid the grant points at");
  });

  it("a mistyped email address is reported, never smoothed over", () => {
    assert.match(PANEL_CODE, /no_account/);
    assert.match(LIB_CODE, /reason: "unavailable"/);
  });
});

/* ================================================================== */
/* 12. sql/099 — the lookup adds reach, not authority                  */
/* ================================================================== */

describe("sql/099 — the candidate directory", () => {
  it("adds exactly two functions and nothing else", () => {
    const creates = dirCode.match(/CREATE (?:OR REPLACE )?FUNCTION/g) ?? [];
    assert.equal(creates.length, 2, "099 should create two functions");
    for (const forbidden of ["CREATE TABLE", "ALTER TABLE", "CREATE POLICY", "DROP POLICY",
      "CREATE BUCKET", "storage.buckets", "ADD COLUMN"]) {
      assert.ok(!dirExecutable.includes(forbidden),
        `099 must not contain ${forbidden}`);
    }
  });

  it("changes nothing created by sql/098", () => {
    /* The two functions 099 is allowed to define, and no others. Anything else
       appearing in a CREATE FUNCTION here would be a redefinition of somebody
       else's object under cover of an additive migration. */
    const defined = [...dirExecutable.matchAll(
      /CREATE\s+(?:OR REPLACE\s+)?FUNCTION\s+public\.(\w+)/g)].map((m) => m[1]);
    assert.deepEqual(defined.sort(), [
      "vyron_grant_company_master_admin_by_email",
      "vyron_list_company_master_candidates",
    ]);
    assert.doesNotMatch(dirExecutable, /DROP FUNCTION/,
      "099 drops nothing; sql/099-rollback.sql does that");
    assert.doesNotMatch(dirExecutable, /ALTER FUNCTION|COMMENT ON TABLE|REVOKE ALL ON TABLE/,
      "099 alters no existing object");
  });

  it("leaves the CORE/HR tenancy spine alone", () => {
    assert.doesNotMatch(dirExecutable, /CREATE OR REPLACE FUNCTION public\.vyron_user_company_ids/);
    assert.doesNotMatch(dirExecutable, /hr_|payroll_|employees/,
      "099 reads no HR or payroll table");
  });

  it("creates no company_users membership", () => {
    assert.doesNotMatch(dirExecutable, /INSERT INTO public\.company_users/);
    assert.doesNotMatch(dirExecutable, /UPDATE public\.company_users/);
  });

  it("both functions are SECURITY DEFINER with a pinned search_path", () => {
    const defs = dirCode.match(/SECURITY DEFINER/g) ?? [];
    assert.equal(defs.length, 2);
    const paths = dirCode.match(/SET search_path = pg_catalog, public/g) ?? [];
    assert.equal(paths.length, 2);
  });

  it("both are gated by the 098 authority check", () => {
    const gates = dirExecutable.match(/vyron_can_manage_company_master_admins\(p_company_id\)/g) ?? [];
    assert.ok(gates.length >= 2,
      `both functions must consult the 098 gate, found ${gates.length}`);
  });

  it("the listing is scoped to exactly the company asked for", () => {
    /* Three association reads, every one keyed on p_company_id. A missing
       predicate here would list another tenant's users. */
    const scoped = dirExecutable.match(/company_id = p_company_id/g) ?? [];
    assert.ok(scoped.length >= 3,
      `every association source must be company-scoped, found ${scoped.length}`);
    assert.doesNotMatch(dirExecutable, /FROM auth\.users u\s*;/,
      "there is no unscoped user listing here");
  });

  it("the grant is delegated, so the write and its audit happen once", () => {
    assert.match(dirExecutable, /public\.vyron_grant_company_master_admin\(p_company_id, v_uid\)/);
    assert.doesNotMatch(dirExecutable, /INSERT INTO public\.vyron_company_master_admins/,
      "099 must not write the grant table itself");
    assert.doesNotMatch(dirExecutable, /INSERT INTO public\.vyron_audit_log/,
      "099 must not write a second audit row");
  });

  it("authority is checked before the email address is read", () => {
    const body = dirExecutable.slice(dirExecutable.indexOf("vyron_grant_company_master_admin_by_email"));
    const gate = body.indexOf("vyron_can_manage_company_master_admins");
    const lookup = body.indexOf("FROM auth.users");
    assert.ok(gate > -1 && lookup > -1 && gate < lookup,
      "an unauthorised caller must not reach the lookup at all");
  });

  it("execute is granted to authenticated and revoked from PUBLIC", () => {
    for (const fn of ["vyron_list_company_master_candidates",
      "vyron_grant_company_master_admin_by_email"]) {
      assert.ok(dirCode.includes(`REVOKE ALL ON FUNCTION public.${fn}`), `${fn} REVOKE`);
      assert.ok(dirCode.includes(`GRANT EXECUTE ON FUNCTION public.${fn}`), `${fn} GRANT`);
    }
  });

  it("is reversible, and the rollback removes only what 099 added", () => {
    assert.match(DIRECTORY_ROLLBACK, /DROP FUNCTION IF EXISTS public\.vyron_list_company_master_candidates/);
    assert.match(DIRECTORY_ROLLBACK, /DROP FUNCTION IF EXISTS public\.vyron_grant_company_master_admin_by_email/);
    const rollbackCode = DIRECTORY_ROLLBACK.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
    assert.doesNotMatch(rollbackCode, /vyron_company_master_admins/,
      "the rollback must not touch the grant table or its history");
    assert.doesNotMatch(rollbackCode, /DROP TABLE|ALTER TABLE/);
  });

  it("is guarded against being applied before 098", () => {
    assert.match(dirCode, /to_regprocedure\('public\.vyron_can_manage_company_master_admins\(uuid\)'\)/);
    assert.match(dirCode, /RAISE EXCEPTION/);
  });

  it("degrades where VYRON SAFETY is not installed", () => {
    assert.match(dirCode, /to_regclass\('public\.safety_user_access'\)/,
      "a CORE-only deployment must still get a working candidate list");
  });
});
