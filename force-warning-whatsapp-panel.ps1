$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$component = @'

async function sendWarningWhatsAppDirect({
  employee,
  warningText,
}: {
  employee: EmployeeRow;
  warningText: string;
}) {
  const employeeName = getEmployeeDisplayName(employee);
  const phone = employee.phone || "";

  if (!phone) {
    return { ok: false, skipped: true, error: `No phone number saved for ${employeeName}.` };
  }

  const message =
    warningText ||
    `Hi ${employeeName}, this is an official HR notice from VYRON CORE. Please contact your manager regarding a warning or HR matter that requires your attention.`;

  const response = await fetch("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: phone,
      message,
      employeeName,
      type: "hr_warning",
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    return { ok: false, skipped: false, error: data.error || "WhatsApp warning failed." };
  }

  return { ok: true, skipped: false, messageId: data.messageId || null };
}

function WarningsWithWhatsAppPanel({
  employees,
  hrCases,
  exceptions,
  leaveRequests,
  payrollHours,
  setActive,
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  leaveRequests: LeaveRequestRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
}) {
  const [employeeId, setEmployeeId] = useState<string>(employees[0]?.id || "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [resultText, setResultText] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId && employees[0]?.id) setEmployeeId(employees[0].id);
  }, [employees, employeeId]);

  const selectedEmployee = employees.find((item) => item.id === employeeId) || employees[0] || null;
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const openExceptions = exceptions.filter(exceptionIsOpen);
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending");

  const employeesWithRisk = employees
    .map((employee) => {
      const employeeCases = openHrCases.filter((item) => item.employee_id === employee.id);
      const employeeExceptions = openExceptions.filter((item) => item.employee_id === employee.id);
      const employeePayroll = payrollBlockers.filter((item) => item.employee_id === employee.id);
      const employeeLeave = leaveRequests.filter((item) => String(item.employee_id || "") === String(employee.id));

      return {
        employee,
        employeeCases,
        employeeExceptions,
        employeePayroll,
        employeeLeave,
        score:
          employeeCases.length * 25 +
          employeeExceptions.length * 15 +
          employeePayroll.length * 20 +
          employeeLeave.filter((item) => item.status === "pending").length * 10,
      };
    })
    .filter((item) => item.score > 0 || item.employeeCases.length > 0)
    .sort((a, b) => b.score - a.score);

  async function sendNow() {
    if (!selectedEmployee) return;

    setSending(true);
    setResultText(null);

    const result = await sendWarningWhatsAppDirect({
      employee: selectedEmployee,
      warningText: message,
    });

    if (result.ok) setResultText(`Warning WhatsApp sent to ${getEmployeeDisplayName(selectedEmployee)}.`);
    if (!result.ok) setResultText(result.error || "Warning WhatsApp failed.");

    setSending(false);
  }

  function fillTemplate() {
    const name = selectedEmployee ? getEmployeeDisplayName(selectedEmployee) : "Employee";
    setMessage(
      `Hi ${name}, this is an official HR notice from VYRON CORE. Please contact your manager regarding a warning or HR matter that requires your attention.`
    );
  }

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-amber-300">WARNING CONTROL</div>
            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">Warnings</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Warning review, employee HR drilldowns and live WhatsApp warning messages.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setActive("WhatsApp Action Centre")}
            className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Open WhatsApp Centre
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-5">
        <button onClick={() => setActive("HR Cases")} className="rounded-[2rem] bg-rose-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-rose-700">HR Cases</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openHrCases.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open case details.</p>
        </button>

        <button onClick={() => setActive("Employee HR File")} className="rounded-[2rem] bg-white p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">Employee Files</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{employeesWithRisk.length}</div>
          <p className="mt-2 text-sm text-slate-500">Open HR files.</p>
        </button>

        <button onClick={() => setActive("Exceptions")} className="rounded-[2rem] bg-amber-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-amber-700">Attendance</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{openExceptions.length}</div>
          <p className="mt-2 text-sm text-slate-500">Investigate exceptions.</p>
        </button>

        <button onClick={() => setActive("Leave Management")} className="rounded-[2rem] bg-emerald-50 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-700">Leave</div>
          <div className="mt-4 text-5xl font-black text-slate-950">{pendingLeave.length}</div>
          <p className="mt-2 text-sm text-slate-500">Review leave context.</p>
        </button>

        <button onClick={() => setActive("Payroll Prep")} className="rounded-[2rem] bg-[#06101f] p-6 text-left text-white shadow-[0_18px_55px_rgba(15,23,42,0.16)] transition hover:-translate-y-1">
          <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-300">Payroll</div>
          <div className="mt-4 text-5xl font-black">{payrollBlockers.length}</div>
          <p className="mt-2 text-sm text-slate-300">Check payroll impact.</p>
        </button>
      </div>

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Warning WhatsApp quick send</h2>
            <p className="mt-2 text-sm text-slate-500">
              Send a live WhatsApp warning/HR notice directly from this page.
            </p>
          </div>

          <button
            type="button"
            onClick={fillTemplate}
            className="rounded-2xl bg-slate-100 px-5 py-3 text-sm font-black text-slate-700"
          >
            Use Template
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-[0.8fr_1.2fr]">
          <label className="text-sm font-bold">
            Employee
            <select
              value={selectedEmployee?.id || ""}
              onChange={(event) => setEmployeeId(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {getEmployeeDisplayName(employee)} {employee.phone ? `- ${employee.phone}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-bold">
            Message
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="mt-2 min-h-28 w-full rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm outline-none focus:border-cyan-400"
              placeholder="Type warning message..."
            />
          </label>
        </div>

        {resultText && <div className="mt-4 rounded-2xl bg-cyan-50 p-4 text-sm font-bold text-cyan-700">{resultText}</div>}

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={sendNow}
            disabled={sending || !selectedEmployee || !message.trim()}
            className="rounded-2xl bg-rose-500 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
          >
            {sending ? "Sending..." : "Send Warning WhatsApp"}
          </button>

          <button
            type="button"
            onClick={() => setActive("Employee HR File")}
            className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-black text-cyan-300"
          >
            Open Employee HR File
          </button>
        </div>
      </Panel>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">Employees needing warning review</h2>
        <p className="mt-2 text-sm text-slate-500">
          Each row links into HR cases, employee files, attendance, leave and payroll.
        </p>

        <div className="mt-6 grid gap-4">
          {employeesWithRisk.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
              No employees currently require warning review.
            </div>
          ) : (
            employeesWithRisk.map(({ employee, employeeCases, employeeExceptions, employeeLeave, employeePayroll, score }) => (
              <div key={employee.id} className="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <button type="button" onClick={() => setActive("Employee HR File")} className="text-left">
                    <div className="text-lg font-black text-slate-950">{getEmployeeDisplayName(employee)}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-500">
                      Risk score {score} · {employee.employee_number || "No employee number"} · {employee.job_title || "No job title"}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                      <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-700">{employeeCases.length} HR case(s)</span>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{employeeExceptions.length} exception(s)</span>
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{employeeLeave.length} leave record(s)</span>
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-cyan-700">{employeePayroll.length} payroll blocker(s)</span>
                    </div>
                  </button>

                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => setActive("Employee HR File")} className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">HR File</button>
                    <button onClick={() => setActive("HR Cases")} className="rounded-2xl bg-rose-500 px-4 py-2 text-sm font-black text-white">HR Case</button>
                    <button onClick={() => setActive("Exceptions")} className="rounded-2xl bg-amber-500 px-4 py-2 text-sm font-black text-white">Attendance</button>
                    <button onClick={() => setActive("Leave Management")} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-black text-white">Leave</button>
                    <button onClick={() => setActive("Payroll Prep")} className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-black text-slate-700">Payroll</button>
                    <button
                      onClick={() => {
                        setEmployeeId(employee.id);
                        setMessage(`Hi ${getEmployeeDisplayName(employee)}, this is an official HR notice from VYRON CORE. Please contact your manager regarding a warning or HR matter that requires your attention.`);
                      }}
                      className="rounded-2xl bg-cyan-500 px-4 py-2 text-sm font-black text-white"
                    >
                      Prepare WhatsApp
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

'@

if ($content -notmatch "function WarningsWithWhatsAppPanel") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$component`nfunction EmptyWorkAreaScreen")
}

# Force Warnings route to this component.
$content = [regex]::Replace(
  $content,
  'if \(active === "Warnings"\)[^\n]*return [^;]+;',
  'if (active === "Warnings") return <WarningsWithWhatsAppPanel employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Warnings"\) \{[\s\S]*?\n\s*\}',
  'if (active === "Warnings") return <WarningsWithWhatsAppPanel employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} />;'
)

if ($content -notmatch 'active === "Warnings"\) return <WarningsWithWhatsAppPanel') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Warnings") return <WarningsWithWhatsAppPanel employees={employees} hrCases={hrCases} exceptions={exceptions} leaveRequests={leaveRequests} payrollHours={payrollHours} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Forced Warnings WhatsApp panel applied."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
