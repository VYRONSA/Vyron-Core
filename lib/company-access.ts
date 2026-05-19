import { SupabaseClient } from "@supabase/supabase-js";

export type VyronCompanyAccess = {
  company_id: string;
  company_name: string;
  user_role: string;
  user_status: string;
  subscription_status: string;
  subscription_locked: boolean;
};

export type VyronCompanyAccessResult = {
  access: VyronCompanyAccess | null;
  error: string | null;
};

// Must match buildSidebarNavGroups in app/page.tsx (userRole === VYRON_MASTER_OPERATOR_ROLE)
export const VYRON_MASTER_OPERATOR_ROLE = "Supervisor Tools";

export const VYRON_MASTER_OPERATOR_EMAIL = "info@vyronsoft.co.za";

/** Maps session email + DB role to the sidebar layout role string page.tsx expects. */
export function resolveVyronLayoutRole(
  email: string,
  roleFromAccess?: string | null
): string {
  if (email.trim().toLowerCase() === VYRON_MASTER_OPERATOR_EMAIL) {
    return VYRON_MASTER_OPERATOR_ROLE;
  }
  return (roleFromAccess || "manager").trim();
}

export async function getCompanyAccess(
  supabase: SupabaseClient
): Promise<VyronCompanyAccessResult> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData?.user?.email) {
      return { access: null, error: "No active user email session discovered." };
    }

    const email = userData.user.email.toLowerCase();
    const userId = userData.user.id;

    const { data: companyUser, error: companyUserError } = await supabase
      .from("company_users")
      .select("company_id, role, status")
      .or(`user_email.eq.${email},auth_user_id.eq.${userId}`)
      .eq("status", "active")
      .maybeSingle();

    if (companyUserError) {
      return { access: null, error: companyUserError.message };
    }

    if (!companyUser?.company_id) {
      return { access: null, error: `No active company mapping bound to account user ${email}.` };
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id, name, subscription_status")
      .eq("id", companyUser.company_id)
      .maybeSingle();

    if (companyError) {
      return { access: null, error: companyError.message };
    }

    if (!company?.id) {
      return { access: null, error: "Company profile workspace entry not registered." };
    }

    const systemRole = resolveVyronLayoutRole(email, companyUser.role || "user");

    const subscriptionStatus = company.subscription_status || "active";

    return {
      access: {
        company_id: company.id,
        company_name: company.name || "VYRON CORE Workspace",
        user_role: systemRole, 
        user_status: companyUser.status || "active",
        subscription_status: subscriptionStatus,
        subscription_locked: !["active", "trialing", "demo"].includes(subscriptionStatus.toLowerCase()),
      },
      error: null,
    };
  } catch (error: any) {
    return { access: null, error: error?.message || "Unknown company security context fault." };
  }
}