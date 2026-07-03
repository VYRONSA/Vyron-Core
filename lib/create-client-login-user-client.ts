import type { CreateClientLoginUserResult } from "@/lib/create-client-login-user";

export type CreateClientLoginUserRequest = {
  email: string;
  password: string;
  companyId: string;
  role?: "owner" | "admin";
};

export async function requestCreateClientLoginUser(
  payload: CreateClientLoginUserRequest,
  accessToken: string
): Promise<CreateClientLoginUserResult> {
  const response = await fetch("/api/developer/create-client-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json().catch(() => ({}))) as CreateClientLoginUserResult & {
    error?: string;
    message?: string;
  };

  if (body.ok) return body;

  return {
    ok: false,
    code: body.code || "auth",
    message:
      body.message ||
      body.error ||
      `Login user could not be created (${response.status}).`,
  };
}
