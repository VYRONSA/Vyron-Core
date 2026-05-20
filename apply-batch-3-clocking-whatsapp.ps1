$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
if (!(Test-Path $path)) { throw "Could not find: $path" }

$content = Get-Content $path -Raw

$helper = @'

async function sendClockingReminderWhatsApp({
  employee,
}: {
  employee: EmployeeRow;
}) {
  const employeeName = getEmployeeDisplayName(employee);
  const phone = employee.phone || "";

  if (!phone) {
    return { ok: false, skipped: true, error: `No phone number saved for ${employeeName}.` };
  }

  const message = `Hi ${employeeName}, VYRON CORE shows a clocking matter that needs attention. Please check your clock-in/clock-out with your manager.`;

  const response = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: phone,
      message,
      employeeName,
      type: "clocking_reminder",
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    return { ok: false, skipped: false, error: data.error || "Clocking WhatsApp failed." };
  }

  return { ok: true, skipped: false, messageId: data.messageId || null };
}

function ClockingWhatsAppReminderPanel({
  employees,
  exceptions,
  setActive,
}: {
  employees: EmployeeRow[];
  exceptions: ExceptionRow[];
  setActive: (value: string) => void;
}) {
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [resultText, setResultText] = useState<string | null>(null);

  const openExceptions = exceptions.filter(exceptionIsOpen);

  async function notifyEmployee(employeeId: string) {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) return;

    setSendingId(employeeId);
    setResultText(null);

    const result = await sendClockingReminderWhatsApp({ employee });

    if (result.ok) setResultText(`Clocking WhatsApp sent to ${getEmployeeDisplayName(employee)}.`);
    if (!result.ok) setResultText(result.error || "Clocking WhatsApp failed.");

    setSendingId(null);
  }

  return (
    <Panel>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Clocking exception WhatsApps</h2>
          <p className="mt-2 text-sm text-slate-500">
            Notify employees with open clocking or attendance exceptions.
          </p>
        </div>

        <button
          onClick={() => setActive("Exceptions")}
          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-cyan-300"
        >
          Open Exceptions
        </button>
      </div>

      {resultText && <div className="mt-4 rounded-2xl bg-cyan-50 p-4 text-sm font-bold text-cyan-700">{resultText}</div>}

      <div className="mt-6 grid gap-3">
        {openExceptions.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
            No open clocking exceptions found.
          </div>
        ) : (
          openExceptions.slice(0, 12).map((item) => {
            const employee = employees.find((row) => row.id === item.employee_id);
            if (!employee) return null;

            return (
              <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm text-slate-500">{item.exception_type} · {item.severity}</div>
                  </div>

                  <button
                    onClick={() => notifyEmployee(employee.id)}
                    disabled={sendingId === employee.id}
                    className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                  >
                    {sendingId === employee.id ? "Sending..." : "Send Reminder"}
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

if ($content -notmatch "function ClockingWhatsAppReminderPanel") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$helper`nfunction EmptyWorkAreaScreen")
}

if ($content -match "function WhatsAppActionCentreLive" -and $content -notmatch "<ClockingWhatsAppReminderPanel") {
  $content = $content.Replace(
    '<PayrollWhatsAppBlockerPanel employees={employees} payrollHours={payrollHours} setActive={setActive} />',
    '<PayrollWhatsAppBlockerPanel employees={employees} payrollHours={payrollHours} setActive={setActive} />' + "`r`n`r`n" +
    '<ClockingWhatsAppReminderPanel employees={employees} exceptions={exceptions} setActive={setActive} />'
  )
  # If exceptions prop missing in route component usage, add to component props and calls.
  $content = $content.Replace(
    'function WhatsAppActionCentreLive({' + "`r`n" + '  employees,' + "`r`n" + '  leaveRequests,' + "`r`n" + '  hrCases,' + "`r`n" + '  payrollHours,',
    'function WhatsAppActionCentreLive({' + "`r`n" + '  employees,' + "`r`n" + '  leaveRequests,' + "`r`n" + '  hrCases,' + "`r`n" + '  payrollHours,' + "`r`n" + '  exceptions,'
  )
  $content = $content.Replace(
    'payrollHours: PayrollHoursRow[];' + "`r`n" + '  setActive:',
    'payrollHours: PayrollHoursRow[];' + "`r`n" + '  exceptions: ExceptionRow[];' + "`r`n" + '  setActive:'
  )
  $content = $content.Replace(
    'payrollHours={payrollHours}' + "`r`n" + '          setActive={setActive}',
    'payrollHours={payrollHours}' + "`r`n" + '          exceptions={exceptions}' + "`r`n" + '          setActive={setActive}'
  )
  $content = $content.Replace(
    'payrollHours={payrollHours} setActive={setActive}',
    'payrollHours={payrollHours} exceptions={exceptions} setActive={setActive}'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 3 applied: Clocking exception WhatsApps."
