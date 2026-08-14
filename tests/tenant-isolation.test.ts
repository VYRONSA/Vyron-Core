/**
 * Tenant isolation.
 *
 * The premise of every test here: the actor's companyId is resolved server-side from the
 * authenticated session and is the ONLY tenant boundary. A caller who knows another
 * company's membership id gains nothing from it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCompanyUser,
  deleteCompanyUser,
  listCompanyUsers,
  resetCompanyUserPassword,
  setCompanyUserStatus,
  updateCompanyUser,
  UserManagementError,
} from "@/lib/tenant/user-management";
import { COMPANY_A, COMPANY_B, customerActor } from "./support/actors";
import { company, fakeAuthUser, FakeStore, membership } from "./support/fake-store";

const A_OWNER = "owner@company-a.test";
const B_OWNER = "owner@company-b.test";
const B_STAFF = "staff@company-b.test";

function twoTenantStore() {
  const aOwner = membership({ company_id: COMPANY_A, user_email: A_OWNER, role: "owner" });
  const aStaff = membership({
    company_id: COMPANY_A,
    user_email: "staff@company-a.test",
    role: "employee",
  });
  const bOwner = membership({ company_id: COMPANY_B, user_email: B_OWNER, role: "owner" });
  const bStaff = membership({ company_id: COMPANY_B, user_email: B_STAFF, role: "manager" });

  const store = new FakeStore({
    companies: [
      company({ id: COMPANY_A, name: "Company A", enabled_modules: ["employees", "leave"] }),
      company({
        id: COMPANY_B,
        name: "Company B",
        enabled_modules: ["employees", "leave", "clocking", "reports"],
      }),
    ],
    memberships: [aOwner, aStaff, bOwner, bStaff],
    authUsers: [
      fakeAuthUser(A_OWNER),
      fakeAuthUser("staff@company-a.test"),
      fakeAuthUser(B_OWNER),
      fakeAuthUser(B_STAFF, "CompanyBPass1"),
    ],
  });

  // Auth ids in the fixture are independent of the fake auth users, so bind them.
  for (const row of store.memberships) {
    row.user_id = store.authUser(row.user_email)?.id ?? row.user_id;
  }

  return { store, aOwner, aStaff, bOwner, bStaff };
}

function actorA(membershipId: string) {
  return customerActor({
    companyId: COMPANY_A,
    role: "owner",
    email: A_OWNER,
    membershipId,
  });
}

async function expectNotFound(promise: Promise<unknown>) {
  try {
    await promise;
    assert.fail("expected a cross-tenant operation to be refused");
  } catch (error) {
    assert.ok(error instanceof UserManagementError, `unexpected error: ${String(error)}`);
    assert.equal(error.status, 404, "a foreign row must be indistinguishable from a missing one");
    assert.match(error.message, /not found in this company/i);
  }
}

describe("tenant isolation — reads", () => {
  it("Company A administrator only ever sees Company A users", async () => {
    const { store, aOwner } = twoTenantStore();

    const directory = await listCompanyUsers(store, actorA(aOwner.id));

    assert.equal(directory.company.id, COMPANY_A);
    assert.equal(directory.users.length, 2);
    for (const user of directory.users) {
      assert.ok(user.email.endsWith("@company-a.test"), `leaked: ${user.email}`);
    }
    assert.equal(
      directory.users.some((user) => user.email === B_STAFF),
      false
    );
  });

  it("exposes only the modules Company A's own subscription includes", async () => {
    const { store, aOwner } = twoTenantStore();
    const directory = await listCompanyUsers(store, actorA(aOwner.id));
    assert.deepEqual(
      directory.availableModules.map((entry) => entry.code),
      ["employees", "leave"]
    );
  });
});

describe("tenant isolation — writes", () => {
  it("Company A cannot edit a Company B user", async () => {
    const { store, aOwner, bStaff } = twoTenantStore();
    await expectNotFound(
      updateCompanyUser(store, actorA(aOwner.id), bStaff.id, { firstName: "Hijacked" })
    );
    assert.equal(store.memberships.find((row) => row.id === bStaff.id)?.first_name, "Test");
  });

  it("Company A cannot reset a Company B user's password", async () => {
    const { store, aOwner, bStaff } = twoTenantStore();
    await expectNotFound(
      resetCompanyUserPassword(store, actorA(aOwner.id), bStaff.id, { passwordMode: "generate" })
    );
    assert.equal(store.authUser(B_STAFF)?.password, "CompanyBPass1");
    assert.equal(store.authCalls.length, 0, "no Auth call may be made for a foreign user");
  });

  it("Company A cannot change a Company B user's role or permissions", async () => {
    const { store, aOwner, bStaff } = twoTenantStore();
    await expectNotFound(
      updateCompanyUser(store, actorA(aOwner.id), bStaff.id, {
        role: "owner",
        modules: ["reports"],
        permissions: { reports: ["admin"] },
      })
    );
    const target = store.memberships.find((row) => row.id === bStaff.id);
    assert.equal(target?.role, "manager");
    assert.equal(target?.module_access, null);
  });

  it("Company A cannot deactivate or delete a Company B user", async () => {
    const { store, aOwner, bStaff } = twoTenantStore();
    await expectNotFound(setCompanyUserStatus(store, actorA(aOwner.id), bStaff.id, false));
    await expectNotFound(deleteCompanyUser(store, actorA(aOwner.id), bStaff.id));

    const target = store.memberships.find((row) => row.id === bStaff.id);
    assert.equal(target?.status, "active");
    assert.equal(target?.deleted_at, null);
  });

  it("writes new users into the actor's company, never a company named in the payload", async () => {
    const { store, aOwner } = twoTenantStore();

    // There is no companyId parameter to tamper with — the actor carries it. This asserts
    // the resulting row is bound to the actor's tenant and to nothing else.
    const result = await createCompanyUser(store, actorA(aOwner.id), {
      firstName: "New",
      lastName: "Person",
      email: "new.person@company-a.test",
      role: "employee",
      passwordMode: "generate",
      modules: null,
    });

    assert.equal(result.user.email, "new.person@company-a.test");
    const created = store.memberships.find((row) => row.user_email === "new.person@company-a.test");
    assert.equal(created?.company_id, COMPANY_A);
    assert.equal(
      store.memberships.filter((row) => row.company_id === COMPANY_B).length,
      2,
      "Company B must be untouched"
    );
  });

  it("audits every attempt against the acting company only", async () => {
    const { store, aOwner } = twoTenantStore();
    await createCompanyUser(store, actorA(aOwner.id), {
      firstName: "Audit",
      lastName: "Target",
      email: "audit@company-a.test",
      role: "employee",
      passwordMode: "generate",
      modules: null,
    });

    assert.ok(store.audits.length > 0);
    for (const entry of store.audits) {
      assert.equal(entry.companyId, COMPANY_A);
      assert.equal(entry.actorEmail, A_OWNER);
    }
  });
});

describe("shared Auth identities", () => {
  it("refuses a password reset for an account that also belongs to another tenant", async () => {
    const { store, aOwner } = twoTenantStore();

    // The same person now holds a seat in both companies.
    const shared = membership({
      company_id: COMPANY_A,
      user_email: B_STAFF,
      role: "manager",
      user_id: store.authUser(B_STAFF)?.id ?? null,
    });
    store.memberships.push(shared);

    try {
      await resetCompanyUserPassword(store, actorA(aOwner.id), shared.id, {
        passwordMode: "generate",
      });
      assert.fail("expected the cross-tenant credential change to be refused");
    } catch (error) {
      assert.ok(error instanceof UserManagementError);
      assert.equal(error.status, 409);
      assert.match(error.message, /another VYRON CORE workspace/i);
    }

    assert.equal(store.authUser(B_STAFF)?.password, "CompanyBPass1");
  });

  it("refuses an email change for an account that also belongs to another tenant", async () => {
    const { store, aOwner } = twoTenantStore();
    const shared = membership({
      company_id: COMPANY_A,
      user_email: B_STAFF,
      role: "manager",
      user_id: store.authUser(B_STAFF)?.id ?? null,
    });
    store.memberships.push(shared);

    await assert.rejects(
      () =>
        updateCompanyUser(store, actorA(aOwner.id), shared.id, {
          email: "captured@company-a.test",
        }),
      (error: unknown) =>
        error instanceof UserManagementError &&
        error.status === 409 &&
        /another VYRON CORE workspace/i.test(error.message)
    );

    assert.equal(store.authUser(B_STAFF)?.email, B_STAFF);
  });

  it("removes company access without disabling an identity used elsewhere", async () => {
    const { store, aOwner } = twoTenantStore();
    const shared = membership({
      company_id: COMPANY_A,
      user_email: B_STAFF,
      role: "manager",
      user_id: store.authUser(B_STAFF)?.id ?? null,
    });
    store.memberships.push(shared);

    const result = await deleteCompanyUser(store, actorA(aOwner.id), shared.id);

    assert.equal(result.user.status, "deleted");
    assert.equal(store.authUser(B_STAFF)?.banned, false, "the other tenant must keep working");
    assert.ok(result.notices.some((notice) => notice.includes("another workspace")));
  });
});
