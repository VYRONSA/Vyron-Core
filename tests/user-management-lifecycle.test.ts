import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deleteCompanyUser,
  listCompanyUsers,
  resendCompanyUserInvite,
  resetCompanyUserPassword,
  restoreCompanyUser,
  setCompanyUserStatus,
  updateCompanyUser,
  UserManagementError,
} from "@/lib/tenant/user-management";
import { validatePassword } from "@/lib/tenant/password-policy";
import { COMPANY_A, customerActor, platformActor } from "./support/actors";
import { company, fakeAuthUser, FakeStore, membership } from "./support/fake-store";

const OWNER_EMAIL = "owner@company-a.test";
const STAFF_EMAIL = "staff@company-a.test";

function scenario(options?: { enabledModules?: string[] }) {
  const owner = membership({ company_id: COMPANY_A, user_email: OWNER_EMAIL, role: "owner" });
  const staff = membership({
    company_id: COMPANY_A,
    user_email: STAFF_EMAIL,
    role: "employee",
    first_name: "Sipho",
    last_name: "Ndlovu",
  });

  const store = new FakeStore({
    companies: [
      company({
        id: COMPANY_A,
        enabled_modules: options?.enabledModules ?? ["employees", "leave", "clocking"],
      }),
    ],
    memberships: [owner, staff],
    authUsers: [fakeAuthUser(OWNER_EMAIL), fakeAuthUser(STAFF_EMAIL, "OriginalPass1")],
  });

  for (const row of store.memberships) {
    row.user_id = store.authUser(row.user_email)?.id ?? row.user_id;
  }

  const actor = customerActor({
    companyId: COMPANY_A,
    role: "owner",
    email: OWNER_EMAIL,
    membershipId: owner.id,
  });

  return { store, owner, staff, actor };
}

async function expectError(promise: Promise<unknown>, status: number, pattern?: RegExp) {
  try {
    await promise;
    assert.fail("expected the operation to be rejected");
  } catch (error) {
    assert.ok(error instanceof UserManagementError, `unexpected error: ${String(error)}`);
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
  }
}

describe("edit user", () => {
  it("updates the profile in both the membership and the Auth identity", async () => {
    const { store, staff, actor } = scenario();

    const result = await updateCompanyUser(store, actor, staff.id, {
      firstName: "Sphiwe",
      lastName: "Ndlovu",
      mobile: "0837654321",
    });

    assert.equal(result.user.firstName, "Sphiwe");
    assert.equal(result.user.mobile, "0837654321");
    const metadataUpdate = store.authCalls.find(
      (call) => call.kind === "update" && call.input.metadata
    );
    assert.ok(metadataUpdate, "profile changes must reach the Auth user metadata too");
  });

  it("changes the email in Supabase Auth as well as the company record", async () => {
    const { store, staff, actor } = scenario();

    const result = await updateCompanyUser(store, actor, staff.id, {
      email: "sipho.ndlovu@company-a.test",
    });

    assert.equal(result.user.email, "sipho.ndlovu@company-a.test");
    assert.equal(store.authUsers.some((user) => user.email === "sipho.ndlovu@company-a.test"), true);
    assert.equal(
      store.authUsers.some((user) => user.email === STAFF_EMAIL),
      false,
      "the Auth identity must not be left on the old address"
    );
  });

  it("refuses an email already used by another user in the company", async () => {
    const { store, staff, actor } = scenario();
    await expectError(
      updateCompanyUser(store, actor, staff.id, { email: OWNER_EMAIL }),
      409,
      /already uses that email/i
    );
  });

  it("records a dedicated audit entry for a role change", async () => {
    const { store, staff, actor } = scenario();

    await updateCompanyUser(store, actor, staff.id, { role: "manager" });

    const roleAudit = store.audits.find((entry) => entry.action === "user_role_changed");
    assert.ok(roleAudit);
    assert.equal(roleAudit.metadata.from, "employee");
    assert.equal(roleAudit.metadata.to, "manager");
  });

  it("records module and permission changes separately", async () => {
    const { store, staff, actor } = scenario();

    await updateCompanyUser(store, actor, staff.id, {
      modules: ["leave"],
      permissions: { leave: ["view", "approve"] },
    });

    assert.ok(store.auditActions().includes("user_module_access_changed"));
    assert.ok(store.auditActions().includes("user_permissions_changed"));
  });

  it("prunes permissions when the module grant is narrowed", async () => {
    const { store, staff, actor } = scenario();

    await updateCompanyUser(store, actor, staff.id, {
      modules: ["leave", "clocking"],
      permissions: { leave: ["approve"], clocking: ["view"] },
    });
    const narrowed = await updateCompanyUser(store, actor, staff.id, { modules: ["leave"] });

    assert.deepEqual(narrowed.user.modules, ["leave"]);
    assert.deepEqual(narrowed.user.permissions, { leave: ["approve"] });
  });

  it("refuses a module the company does not subscribe to", async () => {
    const { store, staff, actor } = scenario({ enabledModules: ["employees", "leave"] });
    await expectError(
      updateCompanyUser(store, actor, staff.id, { modules: ["leave", "payroll_intelligence"] }),
      400,
      /does not include/i
    );
  });

  it("is a no-op when nothing actually changed", async () => {
    const { store, staff, actor } = scenario();
    const result = await updateCompanyUser(store, actor, staff.id, {
      firstName: "Sipho",
      lastName: "Ndlovu",
    });
    assert.deepEqual(result.notices, ["No changes were made."]);
    assert.equal(store.audits.length, 0);
  });
});

describe("self-management limits", () => {
  it("stops an administrator changing their own role", async () => {
    const { store, owner, actor } = scenario();
    await expectError(
      updateCompanyUser(store, actor, owner.id, { role: "employee" }),
      403,
      /your own role/i
    );
  });

  it("stops an administrator deactivating or deleting themselves", async () => {
    const { store, owner, actor } = scenario();
    await expectError(setCompanyUserStatus(store, actor, owner.id, false), 403, /your own status/i);
    await expectError(deleteCompanyUser(store, actor, owner.id), 403, /your own account/i);
  });

  it("still allows an administrator to edit their own profile", async () => {
    const { store, owner, actor } = scenario();
    const result = await updateCompanyUser(store, actor, owner.id, { mobile: "0800000000" });
    assert.equal(result.user.mobile, "0800000000");
  });

  it("marks the actor's own row so the UI can distinguish it", async () => {
    const { store, owner, actor } = scenario();
    const directory = await listCompanyUsers(store, actor);
    const self = directory.users.find((user) => user.id === owner.id);
    assert.equal(self?.isSelf, true);
    assert.equal(self?.canDelete, false);
    assert.equal(self?.canChangeStatus, false);
    assert.equal(self?.canEdit, true);
  });
});

describe("last owner protection", () => {
  it("refuses to deactivate, delete or demote the only active owner", async () => {
    const { store, owner } = scenario();
    const admin = membership({ company_id: COMPANY_A, user_email: "adm@company-a.test", role: "admin" });
    store.memberships.push(admin);
    store.authUsers.push(fakeAuthUser("adm@company-a.test"));
    admin.user_id = store.authUser("adm@company-a.test")?.id ?? null;

    // The platform operator is not the owner, so self-protection does not shadow this.
    const operator = platformActor(COMPANY_A);

    await expectError(setCompanyUserStatus(store, operator, owner.id, false), 400, /last active Owner/i);
    await expectError(deleteCompanyUser(store, operator, owner.id), 400, /last active Owner/i);
    await expectError(
      updateCompanyUser(store, operator, owner.id, { role: "admin" }),
      400,
      /last active Owner/i
    );
  });

  it("allows it once a second owner exists", async () => {
    const { store, owner } = scenario();
    const secondOwner = membership({
      company_id: COMPANY_A,
      user_email: "owner2@company-a.test",
      role: "owner",
    });
    store.memberships.push(secondOwner);
    store.authUsers.push(fakeAuthUser("owner2@company-a.test"));
    secondOwner.user_id = store.authUser("owner2@company-a.test")?.id ?? null;

    const result = await setCompanyUserStatus(store, platformActor(COMPANY_A), owner.id, false);
    assert.equal(result.user.status, "inactive");
  });
});

describe("reset password", () => {
  it("writes the new password to Supabase Auth and nowhere else", async () => {
    const { store, staff, actor } = scenario();

    await resetCompanyUserPassword(store, actor, staff.id, {
      passwordMode: "manual",
      password: "Rotated2026!",
      confirmPassword: "Rotated2026!",
    });

    assert.equal(store.authUser(STAFF_EMAIL)?.password, "Rotated2026!");
    assert.equal(JSON.stringify(store.memberships).includes("Rotated2026!"), false);
    assert.equal(store.auditBlob().includes("Rotated2026!"), false);
  });

  it("returns a generated password once and requires a change on next sign-in", async () => {
    const { store, staff, actor } = scenario();

    const result = await resetCompanyUserPassword(store, actor, staff.id, {
      passwordMode: "generate",
    });

    assert.ok(result.temporaryPassword);
    assert.equal(validatePassword(result.temporaryPassword as string).ok, true);
    assert.equal(result.user.mustChangePassword, true);
    assert.equal(store.authUser(STAFF_EMAIL)?.password, result.temporaryPassword);
  });

  it("enforces the password policy on a manual reset", async () => {
    const { store, staff, actor } = scenario();
    await expectError(
      resetCompanyUserPassword(store, actor, staff.id, {
        passwordMode: "manual",
        password: "weak",
        confirmPassword: "weak",
      }),
      400
    );
    assert.equal(store.authUser(STAFF_EMAIL)?.password, "OriginalPass1");
  });

  it("refuses when the membership has no sign-in account", async () => {
    const { store, staff, actor } = scenario();
    store.memberships.find((row) => row.id === staff.id)!.user_id = null;

    await expectError(
      resetCompanyUserPassword(store, actor, staff.id, { passwordMode: "generate" }),
      400,
      /no sign-in account/i
    );
  });

  it("writes an audit entry naming the actor and target but no credential", async () => {
    const { store, staff, actor } = scenario();
    await resetCompanyUserPassword(store, actor, staff.id, { passwordMode: "generate" });

    const entry = store.audits.find((row) => row.action === "user_password_reset");
    assert.ok(entry);
    assert.equal(entry.actorEmail, OWNER_EMAIL);
    assert.equal(entry.metadata.targetEmail, STAFF_EMAIL);
    // Deliberately not called "passwordMode": redactSecrets() strips every key matching
    // pass|secret|token|credential, and how the credential was issued is worth auditing.
    assert.equal(entry.metadata.method, "generate");
    assert.equal("password" in entry.metadata, false);
    assert.equal(entry.metadata.mustChangePassword, true);
  });
});

describe("deactivate and reactivate", () => {
  it("sets the membership inactive so authentication refuses the workspace", async () => {
    const { store, staff, actor } = scenario();

    const result = await setCompanyUserStatus(store, actor, staff.id, false);

    assert.equal(result.user.status, "inactive");
    const row = store.memberships.find((entry) => entry.id === staff.id);
    // lib/server/authorization.ts and lib/company-access.ts both require status = 'active'.
    assert.notEqual(row?.status, "active");
    assert.ok(row?.deactivated_at);
    assert.ok(store.auditActions().includes("user_deactivated"));
  });

  it("keeps a deactivated user visible rather than hiding them", async () => {
    const { store, staff, actor } = scenario();
    await setCompanyUserStatus(store, actor, staff.id, false);

    const directory = await listCompanyUsers(store, actor);
    const row = directory.users.find((user) => user.id === staff.id);
    assert.ok(row, "a deactivated user must still be listed");
    assert.equal(row.status, "inactive");
  });

  it("reactivates and audits the change", async () => {
    const { store, staff, actor } = scenario();
    await setCompanyUserStatus(store, actor, staff.id, false);
    const result = await setCompanyUserStatus(store, actor, staff.id, true);

    assert.equal(result.user.status, "active");
    assert.equal(store.memberships.find((row) => row.id === staff.id)?.deactivated_at, null);
    assert.ok(store.auditActions().includes("user_activated"));
  });
});

describe("delete and restore", () => {
  it("soft-deletes the membership and preserves the audit history", async () => {
    const { store, staff, actor } = scenario();
    await updateCompanyUser(store, actor, staff.id, { role: "manager" });
    const auditsBefore = store.audits.length;

    const result = await deleteCompanyUser(store, actor, staff.id);

    assert.equal(result.user.status, "deleted");
    const row = store.memberships.find((entry) => entry.id === staff.id);
    assert.ok(row, "the membership row itself must survive for audit attribution");
    assert.ok(row.deleted_at);
    assert.ok(store.audits.length > auditsBefore, "existing audit entries must not be removed");
    assert.ok(store.audits.some((entry) => entry.action === "user_role_changed"));
    assert.ok(store.audits.some((entry) => entry.action === "user_deleted"));
  });

  it("disables the Auth account when this was the user's only workspace", async () => {
    const { store, staff, actor } = scenario();
    await deleteCompanyUser(store, actor, staff.id);
    assert.equal(store.authUser(STAFF_EMAIL)?.banned, true);
  });

  it("hides removed users from the default list but shows them on request", async () => {
    const { store, staff, actor } = scenario();
    await deleteCompanyUser(store, actor, staff.id);

    const defaultView = await listCompanyUsers(store, actor);
    assert.equal(defaultView.users.some((user) => user.id === staff.id), false);

    const fullView = await listCompanyUsers(store, actor, { includeDeleted: true });
    assert.equal(fullView.users.find((user) => user.id === staff.id)?.status, "deleted");
  });

  it("restores a removed user and re-enables their Auth account", async () => {
    const { store, staff, actor } = scenario();
    await deleteCompanyUser(store, actor, staff.id);

    const result = await restoreCompanyUser(store, actor, staff.id);

    assert.equal(result.user.status, "active");
    assert.equal(store.authUser(STAFF_EMAIL)?.banned, false);
    assert.ok(store.auditActions().includes("user_restored"));
  });
});

describe("invitations", () => {
  it("re-sends an invitation and records it", async () => {
    const { store, staff, actor } = scenario();

    const result = await resendCompanyUserInvite(store, actor, staff.id, "https://app.test/invite");

    assert.ok(store.authCalls.some((call) => call.kind === "invite" && call.email === STAFF_EMAIL));
    assert.ok(store.memberships.find((row) => row.id === staff.id)?.invited_at);
    assert.ok(store.auditActions().includes("user_invited"));
    assert.ok(result.notices[0].includes(STAFF_EMAIL));
  });
});

describe("read-only actors", () => {
  it("refuses every mutation for a manager", async () => {
    const { store, staff } = scenario();
    const managerSeat = membership({
      company_id: COMPANY_A,
      user_email: "mgr@company-a.test",
      role: "manager",
    });
    store.memberships.push(managerSeat);

    const manager = customerActor({
      companyId: COMPANY_A,
      role: "manager",
      email: "mgr@company-a.test",
      membershipId: managerSeat.id,
    });

    await expectError(updateCompanyUser(store, manager, staff.id, { role: "admin" }), 403);
    await expectError(
      resetCompanyUserPassword(store, manager, staff.id, { passwordMode: "generate" }),
      403
    );
    await expectError(setCompanyUserStatus(store, manager, staff.id, false), 403);
    await expectError(deleteCompanyUser(store, manager, staff.id), 403);
  });

  it("still lets a manager view the directory, with no action affordances", async () => {
    const { store } = scenario();
    const managerSeat = membership({
      company_id: COMPANY_A,
      user_email: "mgr@company-a.test",
      role: "manager",
    });
    store.memberships.push(managerSeat);

    const directory = await listCompanyUsers(
      store,
      customerActor({
        companyId: COMPANY_A,
        role: "manager",
        email: "mgr@company-a.test",
        membershipId: managerSeat.id,
      })
    );

    assert.equal(directory.actor.canManage, false);
    for (const user of directory.users) {
      assert.equal(user.canEdit, false);
      assert.equal(user.canDelete, false);
      assert.equal(user.canResetPassword, false);
    }
  });

  it("stops an admin acting on an owner", async () => {
    const { store, owner } = scenario();
    const adminSeat = membership({
      company_id: COMPANY_A,
      user_email: "adm@company-a.test",
      role: "admin",
    });
    store.memberships.push(adminSeat);

    const admin = customerActor({
      companyId: COMPANY_A,
      role: "admin",
      email: "adm@company-a.test",
      membershipId: adminSeat.id,
    });

    await expectError(deleteCompanyUser(store, admin, owner.id), 403, /Owner account/i);
    await expectError(
      resetCompanyUserPassword(store, admin, owner.id, { passwordMode: "generate" }),
      403
    );
  });
});
