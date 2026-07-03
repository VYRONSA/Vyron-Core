/**
 * VYRON CORE Phase 5C — WhatsApp Workforce Command engine.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseMissingTableError } from "@/lib/company-access";
import {
  approveAutomationAction,
  loadWorkforceAutomationDashboard,
  prepareAutomationAction,
  rejectAutomationAction,
  type WorkforceAutomationAction,
} from "@/lib/workforce-automation-engine";
import {
  fetchCopilotContext,
  runCopilotQuery,
  type CopilotIntent,
} from "@/lib/workforce-ai-copilot";

const WA_TABLES = [
  "whatsapp_command_sessions",
  "whatsapp_command_messages",
  "whatsapp_command_actions",
  "whatsapp_command_audit_log",
] as const;

export const WHATSAPP_EXAMPLE_COMMANDS = [
  "Who is late today?",
  "Show pending approvals",
  "Approve action ACT-001",
  "Show field jobs active today",
] as const;

export type WhatsAppCommandIntent =
  | CopilotIntent
  | "show_pending_approvals"
  | "show_pending_actions"
  | "approve_action"
  | "reject_action"
  | "show_overtime_risks"
  | "show_field_ops_risks"
  | "escalate_exception"
  | "blocked"
  | "unknown";

export type WhatsAppManagerContext = {
  companyId: string;
  managerPhone: string;
  managerEmail: string | null;
  managerName: string | null;
  sessionId: string | null;
};

export type WhatsAppCommandResult = {
  success: boolean;
  reply: string;
  intent: WhatsAppCommandIntent;
  mockMode: boolean;
  messageId?: string;
  actionRef?: string;
};

export type WhatsAppCommandDashboard = {
  sessions: Record<string, unknown>[];
  recentMessages: Record<string, unknown>[];
  pendingApprovals: Record<string, unknown>[];
  completedActions: Record<string, unknown>[];
  failedCommands: Record<string, unknown>[];
  auditLog: Record<string, unknown>[];
  tablesAvailable: boolean;
  mockMode: boolean;
};

export function isWhatsAppMockMode(): boolean {
  if (process.env.WHATSAPP_WORKFORCE_MOCK_MODE === "true") return true;
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return true;
  return false;
}

export function normaliseWhatsAppPhone(value: string): string {
  let phone = String(value || "").replace(/[^\d]/g, "");
  if (phone.startsWith("00")) phone = phone.slice(2);
  if (phone.startsWith("0")) phone = `27${phone.slice(1)}`;
  return phone;
}

export function phoneMatches(a: string, b: string): boolean {
  const phoneA = normaliseWhatsAppPhone(a);
  const phoneB = normaliseWhatsAppPhone(b);
  if (!phoneA || !phoneB) return false;
  if (phoneA === phoneB) return true;
  const lastA = phoneA.slice(-9);
  const lastB = phoneB.slice(-9);
  return lastA.length >= 9 && lastA === lastB;
}

function isWaMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return WA_TABLES.some((t) => isSupabaseMissingTableError(error, t));
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isBlockedWhatsAppCommand(text: string): boolean {
  const q = text.toLowerCase();
  return (
    /\bdelete\b/.test(q) ||
    /\bremove\b/.test(q) ||
    /payroll export/.test(q) ||
    /export payroll/.test(q) ||
    /delete company/.test(q) ||
    /delete employee/.test(q) ||
    /fire employee/.test(q) ||
    /terminate all/.test(q)
  );
}

export function parseWhatsAppCommand(text: string): WhatsAppCommandIntent {
  const q = text.toLowerCase().trim();
  if (!q) return "unknown";
  if (isBlockedWhatsAppCommand(q)) return "blocked";

  if (/approve action\s+(act-)?[\w-]+/i.test(q)) return "approve_action";
  if (/reject action\s+(act-)?[\w-]+/i.test(q)) return "reject_action";
  if (/show pending approvals|pending approvals|show pending actions/.test(q)) {
    return "show_pending_approvals";
  }
  if (/escalate exception\s+[\w-]+/i.test(q)) return "escalate_exception";
  if (/show overtime risks|overtime risks/.test(q)) return "show_overtime_risks";
  if (/show field operations risks|field ops risks|field operations risks/.test(q)) {
    return "show_field_ops_risks";
  }
  if (/field jobs active|jobs active today|active field jobs/.test(q)) return "active_jobs";
  if (/create warning for/.test(q)) return "action_create_warning";
  if (/approve leave/.test(q)) return "action_approve_leave";
  if (/reject leave|decline leave/.test(q)) return "action_reject_leave";

  if (/who is late|late today/.test(q)) return "who_late";
  if (/who is absent|absent today/.test(q)) return "who_absent";
  if (/who is on leave|on leave/.test(q)) return "who_on_leave";
  if (/who is travelling|who is traveling/.test(q)) return "who_travelling";
  if (/who is on site|on site/.test(q)) return "who_on_site";
  if (/which jobs are active|active jobs/.test(q)) return "active_jobs";
  if (/payroll leakage|leakage risks/.test(q)) return "payroll_leakage";

  return "unknown";
}

function extractActionRef(text: string): string | null {
  const m = text.match(/(?:approve|reject)\s+action\s+(act-[\w-]+|[\w-]{6,})/i);
  if (!m?.[1]) return null;
  const ref = m[1].toUpperCase();
  return ref.startsWith("ACT-") ? ref : `ACT-${ref}`;
}

function extractExceptionId(text: string): string | null {
  const m = text.match(/escalate exception\s+([\w-]+)/i);
  return m?.[1] || null;
}

function makeActionRef(automationId: string): string {
  return `ACT-${automationId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

async function writeWaAudit(
  supabase: SupabaseClient,
  row: {
    companyId: string;
    sessionId?: string | null;
    messageId?: string | null;
    actionId?: string | null;
    eventType: string;
    managerPhone?: string | null;
    managerEmail?: string | null;
    message: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await supabase.from("whatsapp_command_audit_log").insert({
    company_id: row.companyId,
    session_id: row.sessionId || null,
    message_id: row.messageId || null,
    action_id: row.actionId || null,
    event_type: row.eventType,
    manager_phone: row.managerPhone || null,
    manager_email: row.managerEmail || null,
    message: row.message,
    metadata: row.metadata || {},
  });
}

export async function resolveWhatsAppManager(
  supabase: SupabaseClient,
  phone: string,
  mockMode = isWhatsAppMockMode()
): Promise<WhatsAppManagerContext | null> {
  const normalised = normaliseWhatsAppPhone(phone);

  const { data: employees } = await supabase
    .from("employees")
    .select("id, first_name, last_name, email, phone, company_id, job_title")
    .not("phone", "is", null);

  const employee = (employees || []).find((e) => phoneMatches(e.phone || "", normalised));
  if (!employee) {
    if (!mockMode) return null;
    const { data: companies } = await supabase.from("companies").select("id").limit(1);
    const companyId = companies?.[0]?.id;
    if (!companyId) return null;
    return {
      companyId,
      managerPhone: normalised,
      managerEmail: "mock.manager@vyron.test",
      managerName: "Mock Manager",
      sessionId: null,
    };
  }

  const { data: roles } = await supabase
    .from("user_roles")
    .select("user_email, role, company_id")
    .eq("company_id", employee.company_id);

  const email = (employee.email || "").toLowerCase();
  const role = (roles || []).find(
    (r) =>
      (r.user_email || "").toLowerCase() === email &&
      /manager|supervisor|admin|owner|super/i.test(r.role || "")
  );

  if (!role && !mockMode && !/manager|supervisor/i.test(employee.job_title || "")) {
    return null;
  }

  return {
    companyId: employee.company_id,
    managerPhone: normalised,
    managerEmail: role?.user_email || email || null,
    managerName: `${employee.first_name || ""} ${employee.last_name || ""}`.trim() || null,
    sessionId: null,
  };
}

async function ensureSession(
  supabase: SupabaseClient,
  manager: WhatsAppManagerContext,
  mockMode: boolean
): Promise<string | null> {
  const { data, error } = await supabase
    .from("whatsapp_command_sessions")
    .upsert(
      {
        company_id: manager.companyId,
        manager_phone: manager.managerPhone,
        manager_email: manager.managerEmail,
        manager_name: manager.managerName,
        mock_mode: mockMode,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: "active",
      },
      { onConflict: "company_id,manager_phone" }
    )
    .select("id")
    .single();

  if (error && !isWaMissingTable(error)) return null;
  return data?.id || null;
}

async function findAutomationByRef(
  supabase: SupabaseClient,
  companyId: string,
  actionRef: string
): Promise<WorkforceAutomationAction | null> {
  const { data: waAction } = await supabase
    .from("whatsapp_command_actions")
    .select("automation_action_id")
    .eq("company_id", companyId)
    .eq("action_ref", actionRef.toUpperCase())
    .maybeSingle();

  if (waAction?.automation_action_id) {
    const { data } = await supabase
      .from("workforce_automation_actions")
      .select("*")
      .eq("id", waAction.automation_action_id)
      .single();
    return (data as WorkforceAutomationAction) || null;
  }

  const suffix = actionRef.replace(/^ACT-/i, "").toLowerCase();
  const { data: actions } = await supabase
    .from("workforce_automation_actions")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "Pending Approval");

  return (
    (actions || []).find((a) =>
      String(a.id).toLowerCase().startsWith(suffix)
    ) as WorkforceAutomationAction | undefined
  ) || null;
}

export async function processWhatsAppWorkforceCommand(
  supabase: SupabaseClient,
  input: {
    phone: string;
    messageText: string;
    metaMessageId?: string | null;
    companyId?: string;
    managerEmail?: string;
    forceMock?: boolean;
  }
): Promise<WhatsAppCommandResult> {
  const mockMode = input.forceMock ?? isWhatsAppMockMode();
  const intent = parseWhatsAppCommand(input.messageText);

  if (intent === "blocked") {
    return {
      success: false,
      reply: "That command is not allowed. Destructive and payroll export commands are blocked.",
      intent,
      mockMode,
    };
  }

  let manager = await resolveWhatsAppManager(supabase, input.phone, mockMode);
  if (!manager && input.companyId) {
    manager = {
      companyId: input.companyId,
      managerPhone: normaliseWhatsAppPhone(input.phone),
      managerEmail: input.managerEmail || null,
      managerName: null,
      sessionId: null,
    };
  }
  if (!manager) {
    return {
      success: false,
      reply: "Manager not recognised for this phone number. Link a manager phone in employee profile or enable mock mode.",
      intent,
      mockMode,
    };
  }

  const sessionId = await ensureSession(supabase, manager, mockMode);
  manager.sessionId = sessionId;

  const { data: inboundMsg, error: msgError } = await supabase
    .from("whatsapp_command_messages")
    .insert({
      session_id: sessionId,
      company_id: manager.companyId,
      direction: "inbound",
      manager_phone: manager.managerPhone,
      manager_email: manager.managerEmail,
      message_body: input.messageText,
      command_intent: intent,
      status: "received",
      meta_message_id: input.metaMessageId || null,
    })
    .select("id")
    .single();

  if (msgError && !isWaMissingTable(msgError)) {
    return {
      success: false,
      reply: `Command log failed: ${msgError.message}`,
      intent,
      mockMode,
    };
  }

  let reply = "";
  let success = true;
  let actionRef: string | undefined;

  try {
    if (intent === "unknown") {
      reply =
        "Command not recognised. Try: “Who is late today?”, “Show pending approvals”, or “Approve action ACT-001”.";
      success = false;
    } else if (
      intent === "approve_action" ||
      intent === "reject_action"
    ) {
      const ref = extractActionRef(input.messageText);
      if (!ref) {
        reply = "Please specify action ref, e.g. Approve action ACT-001";
        success = false;
      } else {
        const automation = await findAutomationByRef(supabase, manager.companyId, ref);
        if (!automation) {
          reply = `No pending action found for ${ref}. Use “Show pending approvals” first.`;
          success = false;
        } else if (automation.status !== "Pending Approval") {
          reply = `Action ${ref} is not in the approval queue (status: ${automation.status}).`;
          success = false;
        } else {
          const approver = manager.managerEmail || manager.managerPhone;
          if (intent === "approve_action") {
            const result = await approveAutomationAction(supabase, {
              actionId: automation.id,
              companyId: manager.companyId,
              approverEmail: approver,
              notes: "Approved via WhatsApp",
            });
            success = result.ok;
            reply = result.ok
              ? result.message || `${ref} approved.`
              : `Failed: ${result.error || result.message}`;
          } else {
            const result = await rejectAutomationAction(supabase, {
              actionId: automation.id,
              companyId: manager.companyId,
              approverEmail: approver,
              notes: "Rejected via WhatsApp",
            });
            success = result.ok;
            reply = result.ok ? `${ref} rejected.` : `Failed: ${result.error}`;
          }
          actionRef = ref;
          if (success) {
            await supabase
              .from("whatsapp_command_actions")
              .update({
                status: intent === "approve_action" ? "completed" : "rejected",
                completed_at: new Date().toISOString(),
                error_message: null,
              })
              .eq("company_id", manager.companyId)
              .eq("action_ref", ref);
          }
        }
      }
    } else if (intent === "show_pending_approvals" || intent === "show_pending_actions") {
      const dash = await loadWorkforceAutomationDashboard(supabase, manager.companyId);
      const pending = dash.dashboard.approvalQueue;
      if (!pending.length) {
        reply = "No actions pending approval.";
      } else {
        reply = pending
          .slice(0, 8)
          .map((a) => {
            const ref = makeActionRef(a.id);
            return `${ref}: ${a.action_type} — ${a.reason.slice(0, 60)}`;
          })
          .join("\n");
      }
    } else if (intent === "show_overtime_risks") {
      const ctx = await fetchCopilotContext(supabase, manager.companyId);
      const ot = ctx.payrollClockChecks.filter((c) => Number(c.overtime_minutes || 0) > 0);
      reply = ot.length
        ? ot
            .slice(0, 8)
            .map(
              (c) =>
                `Employee ${c.employee_id}: ${c.overtime_minutes} min OT (${c.shift_date})`
            )
            .join("\n")
        : "No overtime risks flagged in payroll clock checks.";
    } else if (intent === "show_field_ops_risks") {
      const ctx = await fetchCopilotContext(supabase, manager.companyId);
      const alerts = ctx.journeyDashboard?.alerts || [];
      reply = alerts.length
        ? alerts
            .slice(0, 8)
            .map((a) => `${a.type}: ${a.message}`)
            .join("\n")
        : "No field operations journey alerts today.";
    } else if (intent === "escalate_exception") {
      const exceptionId = extractExceptionId(input.messageText);
      if (!exceptionId) {
        reply = "Usage: Escalate exception [ID]";
        success = false;
      } else {
        const prep = await prepareAutomationAction(supabase, {
          companyId: manager.companyId,
          actionType: "Escalate Exception",
          preparedByEmail: manager.managerEmail || manager.managerPhone,
          sourceModule: "WhatsApp Command",
          reason: `Escalate exception ${exceptionId} via WhatsApp`,
          payload: { exception_id: exceptionId, severity: "high" },
          submitToQueue: true,
        });
        if (prep.error || !prep.action) {
          reply = `Prepare failed: ${prep.error}`;
          success = false;
        } else {
          actionRef = makeActionRef(prep.action.id);
          await supabase.from("whatsapp_command_actions").insert({
            company_id: manager.companyId,
            session_id: sessionId,
            automation_action_id: prep.action.id,
            action_ref: actionRef,
            command_type: "Escalate Exception",
            manager_phone: manager.managerPhone,
            manager_email: manager.managerEmail,
            status: "pending",
            payload_json: prep.action.payload_json,
          });
          reply = `Exception escalation prepared as ${actionRef}. Reply “Approve action ${actionRef}” to commit.`;
        }
      }
    } else if (
      intent === "action_create_warning" ||
      intent === "action_approve_leave" ||
      intent === "action_reject_leave"
    ) {
      const ctx = await fetchCopilotContext(supabase, manager.companyId);
      const copilotResult = runCopilotQuery(ctx, input.messageText);
      const actionCard = copilotResult.cards.find((c) => c.action);
      if (!actionCard?.action) {
        reply = actionCard?.summary || "Could not prepare action. Include employee name.";
        success = false;
      } else {
        const typeMap = {
          action_create_warning: "Create Warning" as const,
          action_approve_leave: "Approve Leave" as const,
          action_reject_leave: "Reject Leave" as const,
        };
        const prep = await prepareAutomationAction(supabase, {
          companyId: manager.companyId,
          actionType: typeMap[intent as keyof typeof typeMap],
          employeeId: (actionCard.action.payload.employee_id as string) || null,
          preparedByEmail: manager.managerEmail || manager.managerPhone,
          sourceModule: "WhatsApp Command",
          reason: actionCard.action.description,
          payload: actionCard.action.payload,
          submitToQueue: true,
        });
        if (prep.error || !prep.action) {
          reply = `Prepare failed: ${prep.error}`;
          success = false;
        } else {
          actionRef = makeActionRef(prep.action.id);
          await supabase.from("whatsapp_command_actions").insert({
            company_id: manager.companyId,
            session_id: sessionId,
            automation_action_id: prep.action.id,
            action_ref: actionRef,
            command_type: prep.action.action_type,
            manager_phone: manager.managerPhone,
            manager_email: manager.managerEmail,
            status: "pending",
            payload_json: prep.action.payload_json,
          });
          reply = `Prepared ${prep.action.action_type} as ${actionRef}. Reply “Approve action ${actionRef}” to commit.`;
        }
      }
    } else {
      const ctx = await fetchCopilotContext(supabase, manager.companyId);
      const result = runCopilotQuery(ctx, input.messageText);
      const summaries = result.cards.map((c) => `${c.title}: ${c.summary}`);
      if (result.cards[0]?.rows?.length) {
        const rows = result.cards[0].rows
          .slice(0, 6)
          .map((r) => `• ${r.label}: ${r.value}`)
          .join("\n");
        reply = `${summaries[0]}\n${rows}`;
      } else {
        reply = summaries.join("\n") || "No data for that query.";
      }
    }
  } catch (err) {
    success = false;
    reply = err instanceof Error ? err.message : "Command processing failed.";
  }

  const outboundStatus = success ? "sent" : "failed";

  const { data: outbound } = await supabase
    .from("whatsapp_command_messages")
    .insert({
      session_id: sessionId,
      company_id: manager.companyId,
      direction: "outbound",
      manager_phone: manager.managerPhone,
      manager_email: manager.managerEmail,
      message_body: input.messageText,
      command_intent: intent,
      response_body: reply,
      status: outboundStatus,
      error_message: success ? null : reply,
    })
    .select("id")
    .single();

  await writeWaAudit(supabase, {
    companyId: manager.companyId,
    sessionId,
    messageId: inboundMsg?.id || outbound?.id,
    eventType: success ? "command_success" : "command_failed",
    managerPhone: manager.managerPhone,
    managerEmail: manager.managerEmail,
    message: reply,
    metadata: { intent, mockMode, actionRef },
  });

  if (inboundMsg?.id) {
    await supabase
      .from("whatsapp_command_messages")
      .update({
        response_body: reply,
        status: success ? "completed" : "failed",
        error_message: success ? null : reply,
      })
      .eq("id", inboundMsg.id);
  }

  return {
    success,
    reply,
    intent,
    mockMode,
    messageId: outbound?.id,
    actionRef,
  };
}

export async function sendWhatsAppWorkforceReply(
  toPhone: string,
  message: string
): Promise<{ ok: boolean; mock: boolean; error?: string }> {
  if (isWhatsAppMockMode()) {
    return { ok: true, mock: true };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v20.0";
  if (!phoneNumberId || !accessToken) {
    return { ok: false, mock: true, error: "WhatsApp provider not configured." };
  }
  const to = normaliseWhatsAppPhone(toPhone);
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) {
    return { ok: false, mock: false, error: data?.error?.message || "Send failed" };
  }
  return { ok: true, mock: false };
}

export async function loadWhatsAppCommandDashboard(
  supabase: SupabaseClient,
  companyId: string
): Promise<WhatsAppCommandDashboard> {
  const mockMode = isWhatsAppMockMode();
  const [sessions, messages, waActions, audit, automation] = await Promise.all([
    supabase
      .from("whatsapp_command_sessions")
      .select("*")
      .eq("company_id", companyId)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("whatsapp_command_messages")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("whatsapp_command_actions")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("whatsapp_command_audit_log")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50),
    loadWorkforceAutomationDashboard(supabase, companyId),
  ]);

  const missing =
    isWaMissingTable(sessions.error) ||
    isWaMissingTable(messages.error) ||
    isWaMissingTable(waActions.error);

  if (missing) {
    return {
      sessions: [],
      recentMessages: [],
      pendingApprovals: [],
      completedActions: [],
      failedCommands: [],
      auditLog: [],
      tablesAvailable: false,
      mockMode,
    };
  }

  const pendingWa = (waActions.data || []).filter((a) => a.status === "pending");
  const completedWa = (waActions.data || []).filter((a) => a.status === "completed");
  const failedMsgs = (messages.data || []).filter((m) => m.status === "failed");

  return {
    sessions: sessions.data || [],
    recentMessages: messages.data || [],
    pendingApprovals: [
      ...pendingWa,
      ...automation.dashboard.approvalQueue.map((a) => ({
        id: a.id,
        action_ref: makeActionRef(a.id),
        command_type: a.action_type,
        status: "pending",
        reason: a.reason,
        source: "automation_queue",
      })),
    ],
    completedActions: completedWa,
    failedCommands: failedMsgs,
    auditLog: audit.data || [],
    tablesAvailable: true,
    mockMode,
  };
}
