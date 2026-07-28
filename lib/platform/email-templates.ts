/**
 * Branded email template content. These are pure functions returning
 * {subject, html} — reusable, testable, and independent of any delivery
 * mechanism. IMPORTANT: this app has no live transactional email provider wired
 * up (Supabase Auth's own invite/reset emails use Supabase's dashboard-configured
 * templates, not this file). Callers log the rendered output to platform_job_queue
 * (queue_name: "notification") for traceability rather than pretending to send it —
 * see lib/platform/notifications-dispatch.ts.
 */

const BRAND_HEADER = `
  <div style="background:#06101f;padding:24px;text-align:center;">
    <span style="color:#ffffff;font-weight:900;font-size:20px;letter-spacing:0.05em;">VYRON CORE</span>
  </div>
`;

const BRAND_FOOTER = `
  <div style="padding:20px;text-align:center;color:#94a3b8;font-size:12px;">
    VYRON CORE — Workforce Intelligence Platform
  </div>
`;

function wrap(bodyHtml: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">${BRAND_HEADER}<div style="padding:32px;color:#0f172a;">${bodyHtml}</div>${BRAND_FOOTER}</div>`;
}

export type EmailTemplate = { subject: string; html: string };

export function welcomeEmail(params: { companyName: string; adminName: string }): EmailTemplate {
  return {
    subject: `Welcome to VYRON CORE, ${params.companyName}`,
    html: wrap(
      `<h1 style="font-size:20px;">Welcome, ${params.adminName}</h1><p>Your VYRON CORE workspace for <strong>${params.companyName}</strong> is ready.</p>`
    ),
  };
}

export function invitationEmail(params: { companyName: string; inviteUrl: string }): EmailTemplate {
  return {
    subject: `You've been invited to ${params.companyName} on VYRON CORE`,
    html: wrap(
      `<h1 style="font-size:20px;">You're invited</h1><p>You've been invited to administer <strong>${params.companyName}</strong>'s VYRON CORE workspace.</p><p><a href="${params.inviteUrl}" style="color:#0891b2;">Accept invitation</a></p>`
    ),
  };
}

export function passwordResetEmail(params: { resetUrl: string }): EmailTemplate {
  return {
    subject: "Reset your VYRON CORE password",
    html: wrap(
      `<h1 style="font-size:20px;">Password reset</h1><p>Click below to set a new password.</p><p><a href="${params.resetUrl}" style="color:#0891b2;">Reset password</a></p>`
    ),
  };
}

export function subscriptionExpiryEmail(params: { companyName: string; expiresOn: string }): EmailTemplate {
  return {
    subject: `${params.companyName}: subscription expiring soon`,
    html: wrap(`<h1 style="font-size:20px;">Subscription expiring</h1><p>Your licence expires on ${params.expiresOn}.</p>`),
  };
}

export function trialExpiryEmail(params: { companyName: string; expiresOn: string }): EmailTemplate {
  return {
    subject: `${params.companyName}: trial expiring soon`,
    html: wrap(`<h1 style="font-size:20px;">Trial ending soon</h1><p>Your trial ends on ${params.expiresOn}. Upgrade to keep access.</p>`),
  };
}

export function customerSuspendedEmail(params: { companyName: string }): EmailTemplate {
  return {
    subject: `${params.companyName}: account suspended`,
    html: wrap(`<h1 style="font-size:20px;">Account suspended</h1><p>Access to VYRON CORE has been suspended. Contact support to resolve this.</p>`),
  };
}

export function customerReactivatedEmail(params: { companyName: string }): EmailTemplate {
  return {
    subject: `${params.companyName}: account reactivated`,
    html: wrap(`<h1 style="font-size:20px;">Welcome back</h1><p>Your VYRON CORE account has been reactivated.</p>`),
  };
}

export function administratorCreatedEmail(params: { companyName: string; adminEmail: string }): EmailTemplate {
  return {
    subject: `New administrator added to ${params.companyName}`,
    html: wrap(`<h1 style="font-size:20px;">New administrator</h1><p>${params.adminEmail} was added as an administrator for ${params.companyName}.</p>`),
  };
}
