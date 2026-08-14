import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCompanyUser,
  UserManagementError,
  type CreateCompanyUserInput,
} from "@/lib/tenant/user-management";
import { validatePassword } from "@/lib/tenant/password-policy";
import { COMPANY_A, COMPANY_B, customerActor, platformActor } from "./support/actors";
import { company, fakeAuthUser, FakeStore, membership } from "./support/fake-store";

const OWNER_EMAIL = "owner@company-a.test";

function storeWithOwner(overrides?: {
  enabledModules?: string[] | null;
  userLimit?: number | null;
}) {
  const owner = membership({
    company_id: COMPANY_A,
    user_email: OWNER_EMAIL,
    role: "owner",
  });

  return {
    owner,
    store: new FakeStore({
      companies: [
        company({
          id: COMPANY_A,
          enabled_modules:
            overrides?.enabledModules === undefined
              ? ["employees", "leave", "clocking"]
              : overrides.enabledModules,
          user_limit: overrides?.userLimit ?? null,
        }),
      ],
      memberships: [owner],
      authUsers: [fakeAuthUser(OWNER_EMAIL)],
    }),
  };
}

function input(overrides: Partial<CreateCompanyUserInput> = {}): CreateCompanyUserInput {
  return {
    firstName: "Thabo",
    lastName: "Mokoena",
    email: "thabo@company-a.test",
    mobile: "0821234567",
    role: "manager",
    passwordMode: "generate",
    modules: null,
    ...overrides,
  };
}

async function expectRejection(
  promise: Promise<unknown>,
  status: number,
  messageIncludes?: string
) {
  try {
    await promise;
    assert.fail("expected the operation to be rejected");
  } catch (error) {
    assert.ok(error instanceof UserManagementError, `unexpected error: ${String(error)}`);
    assert.equal(error.status, status);
    if (messageIncludes) assert.ok(error.message.includes(messageIncludes), error.message);
  }
}

describe("create user — happy paths", () => {
  it("creates a real Supabase Auth user and a company-scoped membership", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    const result = await createCompanyUser(store, actor, input({ passwordMode: "manual", password: "Vyron2026!", confirmPassword: "Vyron2026!" }));

    assert.equal(result.user.email, "thabo@company-a.test");
    assert.equal(result.user.role, "manager");
    assert.equal(result.user.status, "active");

    const created = store.memberships.find((row) => row.user_email === "thabo@company-a.test");
    assert.ok(created);
    assert.equal(created.company_id, COMPANY_A, "membership must be bound to the actor's company");
    assert.equal(created.first_name, "Thabo");
    assert.equal(created.last_name, "Mokoena");
    assert.equal(created.mobile, "0821234567");

    // The password went to Supabase Auth, with the account confirmed so it can sign in.
    const authCall = store.authCalls.find((call) => call.kind === "create");
    assert.ok(authCall && authCall.kind === "create");
    assert.equal(authCall.password, "Vyron2026!");
    assert.equal(authCall.emailConfirm, true);
    assert.equal(store.authUser("thabo@company-a.test")?.password, "Vyron2026!");
  });

  it("never stores a password anywhere in the application database", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await createCompanyUser(
      store,
      actor,
      input({ passwordMode: "manual", password: "Vyron2026!", confirmPassword: "Vyron2026!" })
    );

    assert.equal(
      JSON.stringify(store.memberships).includes("Vyron2026!"),
      false,
      "company_users must never contain the password"
    );
    assert.equal(
      store.auditBlob().includes("Vyron2026!"),
      false,
      "the audit log must never contain the password"
    );
  });

  it("never echoes an administrator-supplied password back to the caller", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    const result = await createCompanyUser(
      store,
      actor,
      input({ passwordMode: "manual", password: "Vyron2026!", confirmPassword: "Vyron2026!" })
    );

    assert.equal(result.temporaryPassword, undefined);
    assert.equal(JSON.stringify(result).includes("Vyron2026!"), false);
  });

  it("returns a generated temporary password exactly once and flags a required change", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    const result = await createCompanyUser(store, actor, input({ passwordMode: "generate" }));

    assert.ok(result.temporaryPassword, "generate mode must return the password once");
    assert.equal(validatePassword(result.temporaryPassword as string).ok, true);
    assert.equal(result.user.mustChangePassword, true);
    // It reached Auth, and only Auth.
    assert.equal(
      store.authUser("thabo@company-a.test")?.password,
      result.temporaryPassword
    );
    assert.equal(store.auditBlob().includes(result.temporaryPassword as string), false);
  });

  it("sends an invitation instead of a password when asked", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    const result = await createCompanyUser(store, actor, input({ passwordMode: "invite" }));

    assert.equal(result.user.status, "pending");
    assert.ok(store.authCalls.some((call) => call.kind === "invite"));
    assert.equal(store.authCalls.some((call) => call.kind === "create"), false);
    assert.ok(store.auditActions().includes("user_invited"));
  });

  it("records an audit entry with the actor, target, company and change summary", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await createCompanyUser(store, actor, input());

    const entry = store.audits.at(-1);
    assert.ok(entry);
    assert.equal(entry.action, "user_created");
    assert.equal(entry.companyId, COMPANY_A);
    assert.equal(entry.actorEmail, OWNER_EMAIL);
    assert.equal(entry.metadata.targetEmail, "thabo@company-a.test");
    assert.equal(entry.metadata.role, "manager");
  });

  it("lets a platform operator create the first administrator for a customer", async () => {
    const store = new FakeStore({
      companies: [company({ id: COMPANY_A })],
      memberships: [],
    });

    const result = await createCompanyUser(
      store,
      platformActor(COMPANY_A),
      input({ role: "owner", email: "first.admin@company-a.test" })
    );

    assert.equal(result.user.role, "owner");
    assert.equal(store.memberships.length, 1);
    assert.equal(store.memberships[0].company_id, COMPANY_A);
  });
});

describe("create user — module and permission scoping", () => {
  it("refuses modules the company's subscription does not include", async () => {
    const { store, owner } = storeWithOwner({ enabledModules: ["clocking", "employees", "leave", "rostering"] });
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await expectRejection(
      createCompanyUser(store, actor, input({ modules: ["leave", "payroll_intelligence"] })),
      400,
      "payroll_intelligence"
    );
    assert.equal(store.memberships.length, 1, "nothing may be created when validation fails");
  });

  it("stores an explicit grant and drops permissions for modules not granted", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    const result = await createCompanyUser(
      store,
      actor,
      input({
        modules: ["leave"],
        permissions: { leave: ["view", "approve"], clocking: ["admin"] },
      })
    );

    assert.deepEqual(result.user.modules, ["leave"]);
    assert.deepEqual(result.user.permissions, { leave: ["view", "approve"] });
  });

  it("inherits the full subscription when no explicit grant is given", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    const result = await createCompanyUser(store, actor, input({ modules: null }));
    assert.equal(result.user.moduleAccessMode, "all");
    assert.deepEqual(result.user.modules, ["employees", "leave", "clocking"]);
  });
});

describe("create user — authorization", () => {
  it("refuses any platform-level role, including from a platform operator", async () => {
    const attempts = ["super_admin", "platform_admin", "platform_operator", "Supervisor Tools"];

    for (const role of attempts) {
      const { store, owner } = storeWithOwner();
      const customer = customerActor({
        companyId: COMPANY_A,
        role: "owner",
        email: OWNER_EMAIL,
        membershipId: owner.id,
      });

      await expectRejection(createCompanyUser(store, customer, input({ role })), 403, "Platform-level");
      await expectRejection(
        createCompanyUser(store, platformActor(COMPANY_A), input({ role })),
        403,
        "Platform-level"
      );
      assert.equal(store.memberships.length, 1);
    }
  });

  it("stops an admin creating an owner", async () => {
    const { store } = storeWithOwner();
    const adminSeat = membership({ company_id: COMPANY_A, role: "admin", user_email: "adm@company-a.test" });
    store.memberships.push(adminSeat);

    const actor = customerActor({
      companyId: COMPANY_A,
      role: "admin",
      email: "adm@company-a.test",
      membershipId: adminSeat.id,
    });

    await expectRejection(createCompanyUser(store, actor, input({ role: "owner" })), 403);
  });

  it("refuses users who are not owners or admins", async () => {
    for (const role of ["manager", "supervisor", "employee"] as const) {
      const { store } = storeWithOwner();
      const seat = membership({ company_id: COMPANY_A, role, user_email: `${role}@company-a.test` });
      store.memberships.push(seat);

      await expectRejection(
        createCompanyUser(
          store,
          customerActor({
            companyId: COMPANY_A,
            role,
            email: `${role}@company-a.test`,
            membershipId: seat.id,
          }),
          input()
        ),
        403,
        "do not have permission"
      );
    }
  });

  it("rejects an unknown role rather than silently downgrading it", async () => {
    const { store, owner } = storeWithOwner();
    await expectRejection(
      createCompanyUser(
        store,
        customerActor({ companyId: COMPANY_A, role: "owner", email: OWNER_EMAIL, membershipId: owner.id }),
        input({ role: "wizard" })
      ),
      400,
      "not a valid company role"
    );
  });
});

describe("create user — validation and idempotency", () => {
  it("requires a name and a valid email", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await expectRejection(createCompanyUser(store, actor, input({ firstName: " " })), 400);
    await expectRejection(createCompanyUser(store, actor, input({ lastName: "" })), 400);
    await expectRejection(createCompanyUser(store, actor, input({ email: "not-an-email" })), 400);
  });

  it("enforces the password policy for manually set passwords", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await expectRejection(
      createCompanyUser(store, actor, input({ passwordMode: "manual", password: "short", confirmPassword: "short" })),
      400
    );
    await expectRejection(
      createCompanyUser(
        store,
        actor,
        input({ passwordMode: "manual", password: "Vyron2026!", confirmPassword: "Different1!" })
      ),
      400,
      "Confirm password"
    );
  });

  it("refuses a duplicate membership for the same email in the same company", async () => {
    const { store, owner } = storeWithOwner();
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await createCompanyUser(store, actor, input());
    await expectRejection(createCompanyUser(store, actor, input()), 409, "already has access");
    assert.equal(store.memberships.filter((row) => row.user_email === "thabo@company-a.test").length, 1);
  });

  it("enforces the company's licensed user limit", async () => {
    const { store, owner } = storeWithOwner({ userLimit: 1 });
    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await expectRejection(createCompanyUser(store, actor, input()), 400, "licence allows 1");
  });

  it("links an existing Auth identity instead of duplicating it, without touching its password", async () => {
    const { store, owner } = storeWithOwner();
    // The same person already has an account through another workspace.
    store.authUsers.push(fakeAuthUser("shared@example.com", "TheirOwnPass1"));
    store.companies.push(company({ id: COMPANY_B }));
    store.memberships.push(
      membership({ company_id: COMPANY_B, user_email: "shared@example.com", role: "manager" })
    );

    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    const result = await createCompanyUser(
      store,
      actor,
      input({ email: "shared@example.com", passwordMode: "manual", password: "Vyron2026!", confirmPassword: "Vyron2026!" })
    );

    assert.equal(store.authUsers.filter((user) => user.email === "shared@example.com").length, 1);
    assert.equal(
      store.authUser("shared@example.com")?.password,
      "TheirOwnPass1",
      "an existing cross-tenant credential must not be overwritten"
    );
    assert.ok(result.notices.some((notice) => notice.includes("already exists")));
  });

  it("does not present a generated password that was never applied", async () => {
    const { store, owner } = storeWithOwner();
    store.authUsers.push(fakeAuthUser("shared@example.com", "TheirOwnPass1"));

    const result = await createCompanyUser(
      store,
      customerActor({
        companyId: COMPANY_A,
        role: "owner",
        email: OWNER_EMAIL,
        membershipId: owner.id,
      }),
      input({ email: "shared@example.com", passwordMode: "generate" })
    );

    assert.equal(
      result.temporaryPassword,
      undefined,
      "a password that was not set must not be shown to the operator"
    );
    assert.equal(result.user.mustChangePassword, false);
    assert.equal(store.authUser("shared@example.com")?.password, "TheirOwnPass1");
  });

  it("removes a newly created Auth user when the membership write fails", async () => {
    const { store, owner } = storeWithOwner();
    store.failNextInsert = true;

    const actor = customerActor({
      companyId: COMPANY_A,
      role: "owner",
      email: OWNER_EMAIL,
      membershipId: owner.id,
    });

    await assert.rejects(() => createCompanyUser(store, actor, input()));

    assert.equal(
      store.authUsers.some((user) => user.email === "thabo@company-a.test"),
      false,
      "an orphaned auth user must not survive a failed provision"
    );
    assert.ok(store.authCalls.some((call) => call.kind === "delete"));
  });
});
