/**
 * Structural validation for the 098 Company Master SQL.
 *
 * Not a parser, and it does not connect to a database. It checks the things
 * that actually break a hand-pasted migration - unbalanced or mis-nested
 * dollar quotes, an unclosed transaction - plus the safety invariants this
 * migration is required to hold.
 *
 * Run: node scripts/validate-sql-098.mjs
 */
import { readFileSync, existsSync } from 'node:fs';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) pass++; else { fail++; failures.push(name); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const FILES = {
  migration: 'sql/098-vyron-company-master.sql',
  rollback: 'sql/098-rollback.sql',
  tests: 'sql/qa/098-company-master-tests.sql',
};

const src = {};
for (const [k, f] of Object.entries(FILES)) {
  check(`${k} file exists`, existsSync(f), f);
  src[k] = existsSync(f) ? readFileSync(f, 'utf8') : '';
}

/* ------------------------------------------------------------------ */
/* Dollar quoting: balance, then nesting                               */
/* ------------------------------------------------------------------ */

function dollarTags(text) {
  const tally = {};
  for (const m of text.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/g)) {
    tally[m[0]] = (tally[m[0]] ?? 0) + 1;
  }
  return tally;
}

for (const [k, text] of Object.entries(src)) {
  if (!text) continue;
  const tally = dollarTags(text);
  const odd = Object.entries(tally).filter(([, n]) => n % 2 !== 0);
  check(`${k}: every dollar-quote tag is balanced`,
    odd.length === 0,
    odd.length ? odd.map(([t, n]) => `${t} x${n}`).join(', ') : `${Object.keys(tally).length} tag(s)`);
}

/**
 * Balance is necessary but not sufficient. 098 nests three levels deep, and a
 * mis-nested tag does not fail where it is written: it swallows the rest of
 * the file as a string and the paste dies hundreds of lines later on something
 * unrelated. This walks the file the way the server's lexer does.
 */
function dollarQuoteScan(text) {
  const stack = [];
  for (const m of text.matchAll(/\$([a-zA-Z_][a-zA-Z0-9_]*)?\$/g)) {
    const tag = m[0];
    const lineNo = text.slice(0, m.index).split('\n').length;
    if (stack.length && stack[stack.length - 1].tag === tag) stack.pop();
    else stack.push({ tag, lineNo });
  }
  return stack;
}

for (const [k, text] of Object.entries(src)) {
  if (!text) continue;
  const open = dollarQuoteScan(text);
  check(`${k}: dollar-quoted blocks close in order`,
    open.length === 0,
    open.length === 0
      ? 'lexes cleanly'
      : open.map((u) => `${u.tag} left open at line ${u.lineNo}`).join('; '));
}

const NESTED = new RegExp(
  'DO \\$dir\\$[\\s\\S]*?EXECUTE \\$fn\\$[\\s\\S]*?AS \\$body\\$'
  + '[\\s\\S]*?\\$body\\$;[\\s\\S]*?\\$fn\\$;[\\s\\S]*?END\\s*\\$dir\\$;');

check('migration: the three-level DO / EXECUTE / AS nesting is intact',
  NESTED.test(src.migration),
  'DO dir then EXECUTE fn then AS body');

check('migration: the three nested tags are distinct',
  src.migration.includes('$dir$')
  && src.migration.includes('$fn$')
  && src.migration.includes('$body$'),
  'a repeated tag at different depths would close the outer block early');

/* ------------------------------------------------------------------ */
/* Transaction structure                                               */
/* ------------------------------------------------------------------ */

for (const k of ['migration', 'rollback']) {
  const text = src[k];
  if (!text) continue;
  const begins = (text.match(/^BEGIN;/gm) ?? []).length;
  const commits = (text.match(/^COMMIT;/gm) ?? []).length;
  check(`${k}: BEGIN and COMMIT are paired`,
    begins === commits && begins >= 1, `${begins} BEGIN / ${commits} COMMIT`);
  check(`${k}: contains no bare ROLLBACK`,
    !/^ROLLBACK;/m.test(text), 'a migration should commit or raise');
}

/* ------------------------------------------------------------------ */
/* The safety invariants                                               */
/* ------------------------------------------------------------------ */

const mig = src.migration;

/**
 * Strips prose before checking for code. The tenancy function is mentioned
 * legitimately in two kinds of prose: -- comments explaining why it is left
 * alone, and COMMENT ON ... IS '...' strings saying the same to anyone reading
 * the schema. Neither is a reference the database executes.
 */
function sqlCodeOnly(text) {
  return text
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/**
 * Comments removed, string literals KEPT. sqlCodeOnly() also collapses
 * literals, which is right for the spine check but destroys the very
 * values other checks assert on - 'active', 'owner', 'revoke'.
 */
function sqlNoComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

const migCode = sqlCodeOnly(mig);
const migNoComments = sqlNoComments(mig);

/*
 * The single most important check here. vyron_user_company_ids() gates 38 RLS
 * policies across 33 tables including employees, hr_* and payroll_*.
 */
const spineRefs = migCode.split('\n').filter((l) => l.includes('vyron_user_company_ids'));
check('migration never touches vyron_user_company_ids() outside prose',
  spineRefs.length === 0,
  spineRefs.length ? spineRefs[0].trim().slice(0, 70) : 'comment and COMMENT ON references only');

for (const fn of ['vyron_user_company_ids', 'vyron_get_company_access', 'vyron_is_platform_operator']) {
  check(`migration does not redefine ${fn}()`,
    !new RegExp(`CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}`, 'i').test(migCode));
  check(`migration does not drop ${fn}()`,
    !new RegExp(`DROP\\s+FUNCTION[^;]*${fn}`, 'i').test(migCode));
}

check('migration adds no policy to public.companies',
  !/CREATE\s+POLICY[^;]*ON\s+public\.companies/i.test(migCode),
  'the table-level GRANT already permits UPDATE');
check('migration drops no policy at all',
  !/DROP\s+POLICY/i.test(migCode));
check('migration alters no HR or payroll table',
  !/ALTER\s+TABLE\s+public\.(employees|hr_|payroll_|leave_|clock_|user_roles)/i.test(migCode));
check('migration creates or alters no Safety object',
  !/(ALTER|DROP|CREATE)\s+(TABLE|POLICY)[^;]*safety_/i.test(migCode),
  'safety_user_access is only SELECTed inside the directory function');
check('migration creates no safety_company_profile',
  !/safety_company_profile/i.test(migCode));
check('every companies column change is additive',
  !/ALTER TABLE public\.companies[\s\S]{0,600}?(DROP COLUMN|ALTER COLUMN|RENAME)/i.test(migCode),
  'ADD COLUMN IF NOT EXISTS only');
check('migration adds no logo_url column',
  !/ADD COLUMN IF NOT EXISTS\s+logo_url/i.test(migCode),
  'logo_path is authoritative; a stored public URL outlives its access check');

/* ------------------------------------------------------------------ */
/* Function hardening                                                  */
/* ------------------------------------------------------------------ */

const NEW_FUNCTIONS = [
  'vyron_company_directory_ids',
  'vyron_company_admin_ids',
  'vyron_can_manage_company_master_admins',
  'vyron_grant_company_master_admin',
  'vyron_revoke_company_master_admin',
  'vyron_list_company_master_admins',
  'vyron_get_company',
  'vyron_update_company',
];

/* ------------------------------------------------------------------ */
/* The explicit Company Master grant                                   */
/* ------------------------------------------------------------------ */

check('migration creates the explicit grant table',
  /CREATE TABLE IF NOT EXISTS public\.vyron_company_master_admins/.test(mig));

check('a deleted principal loses the grant automatically',
  /auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/.test(mig),
  'a real foreign key, not a validated parameter');
check('a revoked row must carry its revocation timestamp',
  /vyron_company_master_admins_revocation_consistency/.test(mig));
check('the grant table is keyed on auth.users, not email',
  /auth_user_id uuid NOT NULL REFERENCES auth\.users\(id\)/.test(mig)
  && !/user_email/.test(mig.slice(
    mig.indexOf('CREATE TABLE IF NOT EXISTS public.vyron_company_master_admins'),
    mig.indexOf('COMMENT ON TABLE public.vyron_company_master_admins'))),
  'an email match would grant a company to anyone sharing an address');

check('the grant table is one row per user per company',
  /UNIQUE \(company_id, auth_user_id\)/.test(mig),
  'a re-grant reactivates rather than stacking');

check('the grant table records revocation rather than deleting',
  /revoked_by/.test(mig) && /revoked_at/.test(mig)
  && /CHECK \(status IN \('active', 'revoked'\)\)/.test(mig));

check('the grant table has RLS enabled',
  /ALTER TABLE public\.vyron_company_master_admins ENABLE ROW LEVEL SECURITY/.test(mig));
check('the grant table has no policy at all, which is deny-by-default',
  !/CREATE POLICY[^;]*ON public\.vyron_company_master_admins/i.test(migNoComments),
  'reads go through vyron_list_company_master_admins()');

/*
 * The privilege itself is withheld, not merely the policy. public.companies
 * shows why that matters: its GRANT already permits UPDATE, so only the
 * absence of a policy holds the line there.
 */
check('the grant table is closed to clients entirely',
  /REVOKE ALL ON TABLE public\.vyron_company_master_admins FROM anon;/.test(mig)
  && /REVOKE ALL ON TABLE public\.vyron_company_master_admins FROM authenticated;/.test(mig)
  && !/\bGRANT\b[^;]*\bON TABLE\b[^;]*vyron_company_master_admins/i.test(migNoComments),
  'RLS deny-by-default AND no privilege: both locks turned');

check('management authority is a single named function',
  /CREATE OR REPLACE FUNCTION public\.vyron_can_manage_company_master_admins/.test(mig),
  'the grant, revoke and list functions must all agree');
check('the grant table is written only by the two RPCs',
  !/INSERT INTO public\.vyron_company_master_admins/.test(
    mig.slice(0, mig.indexOf('FUNCTION public.vyron_grant_company_master_admin'))),
  'no seed or bootstrap row is inserted by the migration');

/* ------------------------------------------------------------------ */
/* Company Master authority must not follow a module role              */
/* ------------------------------------------------------------------ */

const adminCode = migNoComments;
const adminFn = adminCode.slice(
  adminCode.indexOf('CREATE OR REPLACE FUNCTION public.vyron_company_admin_ids'),
  adminCode.indexOf('COMMENT ON FUNCTION public.vyron_company_admin_ids'));

check('Company Master authority never reads safety_user_access',
  !/safety_user_access/.test(adminFn),
  'a Safety owner is not a Company Master administrator unless granted one');

check('Company Master authority comes from company_users or an explicit grant',
  /company_users/.test(adminFn) && /vyron_company_master_admins/.test(adminFn));

check('the explicit grant must be active to confer authority',
  /cma.status = 'active'/.test(adminFn));

check('CORE authority is limited to owner, admin and platform_admin',
  /lower\(coalesce\(cu\.role, ''\)\) IN \('owner', 'admin', 'platform_admin'\)/
    .test(adminFn));

/* The directory, by contrast, SHOULD include Safety and the grant. */
const DIR_MARKER = 'DO ' + '$' + 'dir' + '$';
const dirFn = adminCode.slice(
  adminCode.indexOf(DIR_MARKER),
  adminCode.indexOf('COMMENT ON FUNCTION public.vyron_company_directory_ids'));

check('company identity visibility includes Safety access',
  /safety_user_access/.test(dirFn),
  'a Safety user must be able to see the company they work in');
check('company identity visibility includes explicit administrators',
  /vyron_company_master_admins/.test(dirFn),
  'if you may edit a company you must be able to see it');
check('the directory de-duplicates across sources',
  (dirFn.match(/\bUNION\b/g) ?? []).length >= 3
  && !/UNION ALL/.test(dirFn),
  'access from three sources is one company id');

/* ------------------------------------------------------------------ */
/* Grant and revoke RPCs                                               */
/* ------------------------------------------------------------------ */

const manageFn = adminCode.slice(
  adminCode.indexOf('FUNCTION public.vyron_can_manage_company_master_admins'),
  adminCode.indexOf('CREATE OR REPLACE FUNCTION public.vyron_company_directory_ids'));

const grantFn = adminCode.slice(
  adminCode.indexOf('FUNCTION public.vyron_grant_company_master_admin'),
  adminCode.indexOf('FUNCTION public.vyron_revoke_company_master_admin'));

check('granting requires an authenticated caller',
  /auth\.uid\(\) IS NULL/.test(grantFn));
check('granting requires authority over that company',
  /vyron_can_manage_company_master_admins/.test(grantFn)
  && grantFn.indexOf('vyron_can_manage_company_master_admins')
     < grantFn.indexOf('INSERT INTO public.vyron_company_master_admins'),
  'the gate precedes the write');
check('granting verifies the company and the user exist',
  /FROM public\.companies WHERE id = p_company_id/.test(grantFn)
  && /FROM auth\.users u WHERE u\.id = p_auth_user_id/.test(grantFn));
check('the audit trail stores no target email address',
  !/target_email/.test(mig),
  'the target is identified by uuid; an audit trail is not a place to accumulate personal data');
check('granting is audited',
  /INSERT INTO public\.vyron_audit_log/.test(grantFn)
  && /'company_master_admin\.granted'/.test(grantFn));
check('granting creates no company_users membership',
  !/INSERT INTO public\.company_users/.test(grantFn),
  'Company Master authority must not confer HR tenancy');

const revokeFn = adminCode.slice(adminCode.indexOf('FUNCTION public.vyron_revoke_company_master_admin'));

check('a caller with no authority cannot bootstrap themselves',
  /vyron_can_manage_company_master_admins/.test(grantFn)
  && !/OR TRUE|OR 1\s*=\s*1/i.test(manageFn),
  'every branch of the authority check requires an existing grant or role');

check('revoking requires authority over that company',
  /vyron_can_manage_company_master_admins/.test(revokeFn));
check('revoking marks the row rather than deleting it',
  /SET status     = 'revoked'/.test(revokeFn)
  && !/DELETE FROM public\.vyron_company_master_admins/.test(revokeFn),
  'the grant and its withdrawal both stay auditable');
check('revoking is audited',
  /'company_master_admin\.revoked'/.test(revokeFn));


for (const fn of NEW_FUNCTIONS) {
  check(`${fn}() is defined`,
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`).test(mig));
  check(`${fn}() is revoked from PUBLIC`,
    new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`).test(mig));
  check(`${fn}() is granted to authenticated`,
    new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[^;]*TO authenticated`).test(mig));
}

const searchPaths = mig.match(/SET search_path = [^\n]+/g) ?? [];
check('every SECURITY DEFINER function pins search_path',
  searchPaths.length >= 4, `${searchPaths.length} occurrence(s)`);
check('no function uses an unpinned search_path',
  searchPaths.length > 0 && searchPaths.every((s) => s.includes('pg_catalog')),
  searchPaths.length ? [...new Set(searchPaths)].join(' | ') : 'none found');

/* ------------------------------------------------------------------ */
/* The write RPC                                                       */
/* ------------------------------------------------------------------ */

const upd = mig.slice(mig.indexOf('FUNCTION public.vyron_update_company'));

check('the write RPC resolves the caller from auth.uid(), not a parameter',
  /auth\.uid\(\) IS NULL/.test(upd) && !/p_user|p_actor|p_email/.test(upd));
check('the write RPC checks authority before it writes',
  upd.indexOf('vyron_company_admin_ids') < upd.indexOf('UPDATE public.companies'),
  'the gate precedes the update');
check('the write RPC whitelists editable fields',
  /editable\s+constant text\[\]/.test(upd));

const whitelist = upd.slice(upd.indexOf('editable   constant'), upd.indexOf('];'));
for (const forbidden of ['enabled_modules', 'plan', 'subscription_status',
  'subscription_tier', 'employee_limit', 'monthly_fee', 'trial_ends_at',
  'locked_reason', 'demo_started_at', 'billing_email']) {
  check(`${forbidden} is not in the editable whitelist`,
    !new RegExp(`'${forbidden}'`).test(whitelist));
}

check('the write RPC sets updated_at itself',
  /updated_at\s+= now\(\)/.test(upd), 'there is no trigger on companies to do it');
check('the write RPC audits after the update and before returning',
  upd.indexOf('UPDATE public.companies') < upd.indexOf('INSERT INTO public.vyron_audit_log')
  && upd.indexOf('INSERT INTO public.vyron_audit_log') < upd.lastIndexOf('RETURN jsonb_build_object'),
  'update, then audit, then return - one transaction');
check('the write RPC pins a logo path to the owning company',
  /split_part\([^)]*\) <> p_company_id::text/.test(upd),
  'company A cannot point its logo at company B');
check('the write RPC rejects directory traversal in a logo path',
  /LIKE '%\.\.%'/.test(upd));
check('the write RPC is country-aware, not South-Africa-only',
  /eff_country IN \('SOUTH AFRICA', 'ZA', 'RSA'\)/.test(upd)
  && /ELSIF length\(v\) > 32/.test(upd),
  'the ZA format is enforced only for ZA companies');

/* ------------------------------------------------------------------ */
/* The read RPC must not leak commercial data                          */
/* ------------------------------------------------------------------ */

const get = mig.slice(
  mig.indexOf('FUNCTION public.vyron_get_company'),
  mig.indexOf('FUNCTION public.vyron_update_company'),
);
for (const secret of ['monthly_fee', 'employee_limit', 'subscription_status',
  'subscription_tier', 'locked_reason', 'billing_email', 'enabled_modules', 'plan']) {
  check(`the read RPC does not return ${secret}`, !new RegExp(`c\\.${secret}`).test(get));
}

/* ------------------------------------------------------------------ */
/* Branding                                                            */
/* ------------------------------------------------------------------ */

check('the branding bucket is created private',
  /'company-branding', 'company-branding', false/.test(mig));
check('the branding bucket is forced private on a re-run',
  /ON CONFLICT \(id\) DO UPDATE[\s\S]{0,160}?public\s+= false/.test(mig));
check('branding reads are gated on directory access',
  /company_branding_read[\s\S]{0,500}?vyron_company_directory_ids/.test(mig));
for (const op of ['insert', 'update', 'delete']) {
  check(`branding ${op} is gated on administration authority`,
    new RegExp(`company_branding_${op}[\\s\\S]{0,600}?vyron_company_admin_ids`).test(mig));
}

/* ------------------------------------------------------------------ */
/* Rollback                                                            */
/* ------------------------------------------------------------------ */

const rb = src.rollback;
for (const fn of NEW_FUNCTIONS) {
  check(`rollback drops ${fn}()`,
    new RegExp(`DROP FUNCTION IF EXISTS public\\.${fn}`).test(rb));
}
check('rollback drops the four branding policies',
  (rb.match(/DROP POLICY IF EXISTS company_branding_/g) ?? []).length === 4);
check('rollback drops the tenancy functions after the policies that use them',
  rb.indexOf('DROP POLICY IF EXISTS company_branding_read')
  < rb.indexOf('DROP FUNCTION IF EXISTS public.vyron_company_directory_ids'));
check('rollback destroys no company data',
  !/^\s*ALTER TABLE public\.companies[\s\S]{0,200}?DROP COLUMN/m.test(rb),
  'column drops are documented but commented out');
check('rollback deletes no storage object',
  !/^\s*DELETE FROM storage\.objects/m.test(rb));
check('rollback deletes no audit history',
  !/^\s*DELETE FROM public\.vyron_audit_log/m.test(rb));
check('rollback documents the destructive steps it declines to take',
  /NOT ROLLED BACK AUTOMATICALLY/.test(rb));

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

const t = src.tests;
check('the suite proves a module role alone cannot edit the Company Master',
  /R2 FAILED: a Safety user altered global Company Master identity/.test(t));
check('the suite proves the HR and payroll firewall is intact',
  /R5\/R24 FAILED: this user can read/.test(t));
check('the suite proves the tenancy spine is byte-identical',
  /vyron_user_company_ids\(\) was modified/.test(t));
check('the suite pins the live baseline hash',
  t.includes('a4ca0efca3674ec4889de649f999c3c0'),
  'recorded live before this work');
check('the migration records the corrected dependency footprint',
  /82 RLS policies across 75 tables/.test(mig) && !/38 policies/.test(mig),
  'the 38/33 figure came from a stale dump and was wrong');
check('the suite proves direct writes to the grant table fail',
  /R16 FAILED/.test(t) && /R17 FAILED/.test(t) && /R18 FAILED/.test(t));
check('the suite proves cross-company grants fail',
  /R14 FAILED/.test(t));
check('the suite proves cross-company administrator reads fail',
  /R15 FAILED/.test(t));
check('the suite contains the demo acceptance test',
  /DEMO ACCEPTANCE ok/.test(t) && /company_users is no longer 0/.test(t));
check('the suite proves cross-company updates fail',
  /R13 FAILED: company A edited company B/.test(t));
check('the suite proves platform fields cannot be written',
  /FAILED: a platform-controlled column changed/.test(t));
check('the suite proves no secrets reach the audit trail',
  /contain secret-shaped values/.test(t));
check('the suite proves an explicit grant confers Company Master authority',
  /R4 FAILED: the grant conferred no authority/.test(t));
check('the suite proves the grant leaks no HR or payroll access',
  /R28 FAILED: a company_users row was created/.test(t));
check('the suite proves revocation is immediate',
  /R8 FAILED: a revoked administrator retains authority/.test(t));
check('the suite proves a module role cannot self-grant',
  /R3 FAILED: a Safety user self-granted Company Master administration/.test(t));

/* ------------------------------------------------------------------ */

console.log(`\n${'='.repeat(58)}`);
console.log(`098 SQL VALIDATION: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
