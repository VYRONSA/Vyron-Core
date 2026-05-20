$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"
$pagePath = Join-Path $root "app\page.tsx"
$routeDir = Join-Path $root "app\api\whatsapp\send"
$routePath = Join-Path $routeDir "route.ts"

if (!(Test-Path $root)) { throw "Project folder not found: $root" }
if (!(Test-Path $pagePath)) { throw "Could not find: $pagePath" }

New-Item -ItemType Directory -Force -Path $routeDir | Out-Null

@'
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function normalisePhone(value: string) {
  let phone = String(value || "").trim().replace(/[^\d]/g, "");
  if (phone.startsWith("0")) phone = `27${phone.slice(1)}`;
  if (phone.startsWith("00")) phone = phone.slice(2);
  return phone;
}

export async function POST(request: NextRequest) {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v20.0";

    if (!phoneNumberId) {
      return NextResponse.json({ ok: false, error: "Missing WHATSAPP_PHONE_NUMBER_ID in .env.local" }, { status: 500 });
    }

    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "Missing WHATSAPP_ACCESS_TOKEN in .env.local" }, { status: 500 });
    }

    const body = await request.json();
    const to = normalisePhone(body?.to || "");
    const message = String(body?.message || "").trim();

    if (!to) return NextResponse.json({ ok: false, error: "Recipient phone number is required." }, { status: 400 });
    if (!message) return NextResponse.json({ ok: false, error: "Message is required." }, { status: 400 });

    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: message,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { ok: false, error: data?.error?.message || "WhatsApp send failed.", meta: data },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      messageId: data?.messages?.[0]?.id || null,
      to,
      meta: data,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Unknown WhatsApp API error." }, { status: 500 });
  }
}
'@ | Set-Content -Path $routePath -Encoding UTF8

$content = Get-Content $pagePath -Raw

$component = @'

function WhatsAppActionCentreLive({
  employees,
  leaveRequests,
  hrCases,
  payrollHours,
  setActive,
}: {
  employees: EmployeeRow[];
  leaveRequests: LeaveRequestRow[];
  hrCases: HrCaseRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
}) {
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>(employees[0]?.id || "");
  const [customPhone, setCustomPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedEmployeeId && employees[0]?.id) setSelectedEmployeeId(employees[0].id);
  }, [employees, selectedEmployeeId]);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) || employees[0] || null;
  const employeeName = selectedEmployee ? getEmployeeDisplayName(selectedEmployee) : "Employee";
  const employeePhone = selectedEmployee?.phone || "";
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending");
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);

  function setTemplate(type: "warning" | "leave_approved" | "leave_declined" | "hr_notice" | "payroll") {
    if (type === "warning") {
      setMessage(`Hi ${employeeName}, this is an official HR notice from VYRON CORE. Please contact your manager regarding an HR matter that requires your attention.`);
    }
    if (type === "leave_approved") {
      setMessage(`Hi ${employeeName}, your leave request has been approved. Please check with your manager if you need any further details.`);
    }
    if (type === "leave_declined") {
      setMessage(`Hi ${employeeName}, your leave request has not been approved at this stage. Please contact your manager for feedback.`);
    }
    if (type === "hr_notice") {
      setMessage(`Hi ${employeeName}, please note that there is an HR update linked to your employee file. Your manager will provide further details.`);
    }
    if (type === "payroll") {
      setMessage(`Hi ${employeeName}, there is a payroll or clocking matter that needs attention before payroll can be finalised. Please contact your manager.`);
    }
  }

  async function sendWhatsApp() {
    const to = customPhone.trim() || employeePhone;
    setSending(true);
    setSendStatus(null);
    setSendError(null);

    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message, employeeName, type: "manual_hr_message" }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setSendError(data.error || "WhatsApp message failed.");
        setSending(false);
        return;
      }

      setSendStatus(`WhatsApp sent successfully. Message ID: ${data.messageId || "sent"}`);
      setSending(false);
    } catch (error: any) {
      setSendError(error?.message || "Could not send WhatsApp message.");
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-emerald-300">WHATSAPP LIVE</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">WhatsApp Action Centre</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Send live WhatsApp messages for warnings, leave feedback, HR notices, payroll blockers and employee reminders.
            </p>
          </div>

          <button type="button" onClick={() => setActive("Employee HR File")} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl">
            Open Employee HR File
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-3">
        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-600">HR Cases</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Open HR cases available for WhatsApp follow-up.</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-600">Leave</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{pendingLeave.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Pending leave requests available for employee feedback.</p>
        </Panel>

        <Panel>
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-600">Payroll</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{payrollBlockers.length}</div>
          <p className="mt-2 text-sm font-semibold text-slate-500">Payroll blockers that may need employee action.</p>
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Panel>
          <h2 className="text-2xl font-black text-slate-950">Recipient</h2>
          <p className="mt-2 text-sm text-slate-500">Select an employee or type a number manually. Numbers can start with 0 or 27.</p>

          <label className="mt-6 block text-sm font-bold">
            Employee
            <select
              value={selectedEmployee?.id || ""}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {getEmployeeDisplayName(employee)} {employee.phone ? `- ${employee.phone}` : ""}
                </option>
              ))}
            </select>
          </label>

          <FormInput label="Manual phone override" value={customPhone} onChange={setCustomPhone} placeholder="Example: 0720804844 or 27720804844" />

          <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-600">
            Current target: {customPhone.trim() || employeePhone || "No phone number saved"}
          </div>
        </Panel>

        <Panel>
          <h2 className="text-2xl font-black text-slate-950">Message templates</h2>
          <p className="mt-2 text-sm text-slate-500">Use templates as a starting point, then edit the message before sending.</p>

          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <button onClick={() => setTemplate("warning")} className="rounded-2xl bg-rose-50 p-4 text-left text-sm font-black text-rose-700">Warning / HR notice</button>
            <button onClick={() => setTemplate("leave_approved")} className="rounded-2xl bg-emerald-50 p-4 text-left text-sm font-black text-emerald-700">Leave approved</button>
            <button onClick={() => setTemplate("leave_declined")} className="rounded-2xl bg-amber-50 p-4 text-left text-sm font-black text-amber-700">Leave declined</button>
            <button onClick={() => setTemplate("payroll")} className="rounded-2xl bg-cyan-50 p-4 text-left text-sm font-black text-cyan-700">Payroll / clocking issue</button>
          </div>

          <label className="mt-6 block text-sm font-bold">
            WhatsApp message
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="mt-2 min-h-40 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
              placeholder="Type WhatsApp message..."
            />
          </label>

          {sendStatus && <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{sendStatus}</div>}
          {sendError && <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{sendError}</div>}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={sendWhatsApp}
              disabled={sending || !message.trim() || !(customPhone.trim() || employeePhone)}
              className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            >
              {sending ? "Sending..." : "Send WhatsApp"}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

'@

if ($content -notmatch "function WhatsAppActionCentreLive") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

$content = [regex]::Replace(
  $content,
  'if \(active === "Employee Notifications"\)[^\n]*return [^;]+;',
  'if (active === "Employee Notifications") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} payrollHours={payrollHours} setActive={setActive} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Notifications"\)[^\n]*return [^;]+;',
  'if (active === "Notifications") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} payrollHours={payrollHours} setActive={setActive} />;'
)

if ($content -notmatch 'active === "Employee Notifications"\) return <WhatsAppActionCentreLive') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Employee Notifications") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} payrollHours={payrollHours} setActive={setActive} />;' + "`r`n" +
    '    if (active === "Notifications") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} payrollHours={payrollHours} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $pagePath -Value $content -Encoding UTF8

@'
WHATSAPP_PHONE_NUMBER_ID=1105611779304961
WHATSAPP_BUSINESS_ACCOUNT_ID=1500670084851932
WHATSAPP_ACCESS_TOKEN=paste_your_permanent_token_here
WHATSAPP_GRAPH_VERSION=v20.0
'@ | Set-Content -Path (Join-Path $root ".env.whatsapp.example") -Encoding UTF8

Write-Host ""
Write-Host "VYRON CORE WhatsApp engine applied."
Write-Host ""
Write-Host "Add these to .env.local:"
Write-Host "WHATSAPP_PHONE_NUMBER_ID=1105611779304961"
Write-Host "WHATSAPP_BUSINESS_ACCOUNT_ID=1500670084851932"
Write-Host "WHATSAPP_ACCESS_TOKEN=your permanent token"
Write-Host "WHATSAPP_GRAPH_VERSION=v20.0"
