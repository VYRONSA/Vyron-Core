$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$safeTasks = @'

function SafeTasksActionCentre({
  leaveRequests,
  hrCases,
  exceptions,
  payrollHours,
  setActive,
}: {
  leaveRequests: LeaveRequestRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  payrollHours: PayrollHoursRow[];
  setActive: (value: string) => void;
}) {
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending");
  const openHrCases = hrCases.filter(hrCaseIsOpen);
  const openExceptions = exceptions.filter(exceptionIsOpen);
  const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);

  const tasks = [
    {
      title: "Leave approvals",
      count: pendingLeave.length,
      description: "Approve, decline or amend employee leave requests.",
      target: "Leave Management",
      tone: "emerald",
    },
    {
      title: "HR cases",
      count: openHrCases.length,
      description: "Review HR cases, employee responses and disciplinary follow-up.",
      target: "HR Cases",
      tone: "rose",
    },
    {
      title: "Clocking exceptions",
      count: openExceptions.length,
      description: "Investigate unresolved clocking, roster and operational exceptions.",
      target: "Exceptions",
      tone: "amber",
    },
    {
      title: "Payroll blockers",
      count: payrollBlockers.length,
      description: "Resolve payroll issues before export or month-end processing.",
      target: "Payroll Prep",
      tone: "cyan",
    },
  ];

  return (
    <div className="space-y-8">
      <Panel dark>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">
              MANAGER ACTION CENTRE
            </div>

            <h1 className="mt-3 text-4xl font-black tracking-tight md:text-5xl">
              Tasks
            </h1>

            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              Live action queue for managers. This safe version does not depend on the broken employee_notifications query.
            </p>
          </div>

          <button
            onClick={() => setActive("Command Centre")}
            className="w-fit rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950 shadow-xl"
          >
            Back to Dashboard
          </button>
        </div>
      </Panel>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {tasks.map((task) => (
          <button
            key={task.title}
            type="button"
            onClick={() => setActive(task.target)}
            className="rounded-[2rem] border border-white/80 bg-white/95 p-6 text-left shadow-[0_18px_55px_rgba(15,23,42,0.12)] transition hover:-translate-y-1 hover:shadow-[0_28px_75px_rgba(37,99,235,0.16)]"
          >
            <div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-700">
              {task.title}
            </div>

            <div className="mt-4 text-5xl font-black text-slate-950">
              {task.count}
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-500">
              {task.description}
            </p>

            <div className="mt-5 text-sm font-black text-cyan-700">
              Open workflow →
            </div>
          </button>
        ))}
      </div>

      <Panel>
        <h2 className="text-2xl font-black text-slate-950">
          Current action queue
        </h2>

        <p className="mt-2 text-sm text-slate-500">
          Click a task row to open the correct operational page.
        </p>

        <div className="mt-6 grid gap-3">
          {tasks.every((task) => task.count === 0) ? (
            <div className="rounded-2xl bg-emerald-50 p-5 text-sm font-bold text-emerald-700">
              No urgent manager tasks right now.
            </div>
          ) : (
            tasks
              .filter((task) => task.count > 0)
              .map((task) => (
                <button
                  key={task.title}
                  onClick={() => setActive(task.target)}
                  className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-200"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-black text-slate-950">
                        {task.title}
                      </div>

                      <div className="mt-1 text-sm text-slate-500">
                        {task.description}
                      </div>
                    </div>

                    <span className="inline-flex w-fit items-center rounded-full bg-rose-500 px-3 py-1 text-xs font-black text-white">
                      {task.count}
                    </span>
                  </div>
                </button>
              ))
          )}
        </div>
      </Panel>
    </div>
  );
}

'@

if ($content -notmatch "function SafeTasksActionCentre") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$safeTasks`nfunction EmptyWorkAreaScreen")
}

# Replace Manager Action Centre route if it exists.
$content = [regex]::Replace(
  $content,
  'if \(active === "Manager Action Centre"\) return <ManagerActionCentrePanel[\s\S]*?/>;',
  'if (active === "Manager Action Centre") return <SafeTasksActionCentre leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;'
)

# If route did not exist or regex failed, add it before fallback.
if ($content -notmatch 'active === "Manager Action Centre"\) return <SafeTasksActionCentre') {
  $content = $content.Replace(
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;',
    '    if (active === "Manager Action Centre") return <SafeTasksActionCentre leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;' + "`r`n`r`n" +
    '    return <EmptyWorkAreaScreen title={active} setActive={setActive} />;'
  )
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Tasks safe fix applied."
Write-Host "Tasks now uses a safe live action hub and does not query employee_notifications."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
