$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find: $path" }

$content = Get-Content $path -Raw

$helper = @'

async function sendPayrollBlockerWhatsApp({
  employee,
}: {
  employee: EmployeeRow;
}) {
  const employeeName = getEmployeeDisplayName(employee);
  const phone = employee.phone || "";

  if (!phone) {
    return { ok: false, skipped: true, error: `No phone number saved for ${employeeName}.` };
  }

  const message = `Hi ${employeeName}, there is a clocking or payroll matter that needs attention before payroll can be finalised. Please contact your manager. Regards, VYRON CORE.`;

  const response = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: phone,
      message,
      employeeName,
      type: "payroll_blocker",
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    return { ok: false, skipped: false, error: data.error || "Payroll WhatsApp failed." };
  }

  return { ok: true, skipped: false, messageId: data.messageId || null };
}

function PayrollWhatsAppBlockerPanel({
  employees,
  payrollHours,
  setActive,
}: {
  employees: EmployeeRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
}) {
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);

  const blockers = payrollHours.filter(rowHasPayrollProblem);

  async function notifyEmployee(employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) return;

    setSendingId(employeeId);
    setResultText(null);

    const result = await sendPayrollBlockerWhatsApp({ employee });

    if (result.ok) setResultText(`Payroll WhatsApp sent to ${getEmployeeDisplayName(employee)}.`);
    if (!result.ok) setResultText(result.error || "Payroll WhatsApp failed.");

    setSendingId(null);
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Payroll blocker WhatsApps</h2>
          <p className="mt-2 text-sm text-slate-500">
            Notify employees where payroll/clocking issues may block payroll readiness.
          </p>
        </div>

        <button
          onClick={() => setActive("WhatsApp Action Centre")}
          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-cyan-300"
        >
          Open WhatsApp Centre
        </button>
      </div>

      {resultText && <div className="mt-4 rounded-2xl bg-cyan-50 p-4 text-sm font-bold text-cyan-700">{resultText}</div>}

      <div className="mt-6 grid gap-3">
        {blockers.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
            No payroll blockers found.
          </div>
        ) : (
          blockers.slice(0, 12).map((blocker) => {
            const employee = employees.find((item) => item.id === blocker.employee_id);
            if (!employee) return null;

            return (
              <div key={blocker.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm text-slate-500">
                      Missing clock events: {blocker.missing_clock_events} · Late minutes: {blocker.late_minutes}
                    </div>
                  </div>

                  <button
                    onClick={() => notifyEmployee(employee.id)}
                    disabled={sendingId === employee.id}
                    className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                  >
                    {sendingId === employee.id ? "Sending..." : "Send WhatsApp"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

'@

if ($content -notmatch "function PayrollWhatsAppBlockerPanel") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$helper`nfunction EmptyWorkAreaScreen")
}

# Add into WhatsApp action centre after metrics if possible.
if ($content -match "function WhatsAppActionCentreLive" -and $content -notmatch "<PayrollWhatsAppBlockerPanel") {
  $content = $content.Replace(
    '<div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">',
    '<PayrollWhatsAppBlockerPanel employees={employees} payrollHours={payrollHours} setActive={setActive} />' + "`r`n`r`n" +
    '<div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">',
    1
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 2 applied: Payroll blocker WhatsApps."
