import { getSupabaseAdminClient } from "@/lib/server-api-auth";
import { normalizeVyronEmail } from "@/lib/company-access";

export type CreateClientLoginUserInput = {
  email: string;
  /** Omit to send an invite email instead of setting a temporary password (Platform Console customer creation). */
  password?: string;
  companyId: string;
  role?: "owner" | "admin";
  /** Only used when password is omitted — where the invite email link lands. */
  inviteRedirectTo?: string;
  /** Profile fields (first/last name, mobile) stored as Auth user_metadata — display only, never a privilege claim. */
  metadata?: Record<string, unknown>;
};

export type CreateClientLoginUserResult =
  | { ok: true; userId: string; email: string; invited?: boolean }
  | { ok: false; code: "missing_service_key" | "validation" | "auth" | "database"; message: string };

const MIN_PASSWORD_LENGTH = 8;

export function validateClientLoginPassword(password: string, confirmPassword: string): string | null {
  if (!password.trim()) return "Temporary password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmPassword) return "Confirm password must match the temporary password.";
  return null;
}

export async function createClientLoginUser(
  input: CreateClientLoginUserInput
): Promise<CreateClientLoginUserResult> {
  const email = normalizeVyronEmail(input.email);
  const companyId = (input.companyId || "").trim();
  const password = input.password || "";
  const inviteMode = !input.password;
  const role = input.role === "admin" ? "admin" : "owner";

  if (!email || !email.includes("@")) {
    return { ok: false, code: "validation", message: "A valid primary admin email is required." };
  }
  if (!companyId) {
    return { ok: false, code: "validation", message: "companyId is required." };
  }
  if (!inviteMode && password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: "validation",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) {
    return {
      ok: false,
      code: "missing_service_key",
      message:
        "Client was created, but login user could not be created because server admin key is missing.",
    };
  }

  let admin;
  try {
    admin = getSupabaseAdminClient();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server admin client is not configured.";
    return { ok: false, code: "missing_service_key", message };
  }

  let userId: string | null = null;

  if (inviteMode) {
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: input.inviteRedirectTo,
      data: input.metadata,
    });
    userId = invited.user?.id || null;

    if (inviteError) {
      const lower = inviteError.message.toLowerCase();
      if (
        lower.includes("already been registered") ||
        lower.includes("already registered") ||
        lower.includes("user already registered") ||
        lower.includes("already invited")
      ) {
        const { data: listed, error: listError } = await admin.auth.admin.listUsers();
        if (listError) {
          return { ok: false, code: "auth", message: listError.message };
        }
        const existing = listed.users.find((user) => normalizeVyronEmail(user.email) === email);
        if (!existing?.id) {
          return { ok: false, code: "auth", message: inviteError.message };
        }
        userId = existing.id;
      } else {
        return { ok: false, code: "auth", message: inviteError.message };
      }
    }
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: input.metadata,
    });

    userId = created.user?.id || null;

    if (createError) {
      const lower = createError.message.toLowerCase();
      if (
        lower.includes("already been registered") ||
        lower.includes("already registered") ||
        lower.includes("user already registered")
      ) {
        const { data: listed, error: listError } = await admin.auth.admin.listUsers();
        if (listError) {
          return { ok: false, code: "auth", message: listError.message };
        }
        const existing = listed.users.find((user) => normalizeVyronEmail(user.email) === email);
        if (!existing?.id) {
          return { ok: false, code: "auth", message: createError.message };
        }
        userId = existing.id;
        const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
        });
        if (updateError) {
          return { ok: false, code: "auth", message: updateError.message };
        }
      } else {
        return { ok: false, code: "auth", message: createError.message };
      }
    }
  }

  if (!userId) {
    return { ok: false, code: "auth", message: "Auth user could not be created." };
  }

  const { data: existingMapping, error: mappingReadError } = await admin
    .from("company_users")
    .select("id")
    .eq("company_id", companyId)
    .ilike("user_email", email)
    .maybeSingle();

  if (mappingReadError) {
    return { ok: false, code: "database", message: mappingReadError.message };
  }

  if (existingMapping?.id) {
    const { error: updateMappingError } = await admin
      .from("company_users")
      .update({
        user_id: userId,
        role,
        status: "active",
        user_email: email,
      })
      .eq("id", existingMapping.id);

    if (updateMappingError) {
      return { ok: false, code: "database", message: updateMappingError.message };
    }
  } else {
    const { error: insertMappingError } = await admin.from("company_users").insert({
      company_id: companyId,
      user_email: email,
      user_id: userId,
      role,
      status: "active",
    });

    if (insertMappingError) {
      return { ok: false, code: "database", message: insertMappingError.message };
    }
  }

  return { ok: true, userId, email, invited: inviteMode };
}
