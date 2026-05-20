$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$helpers = @'

function getWhatsAppPendingCounts({
  leaveRequests,
  hrCases,
  exceptions,
  payrollHours,
}: {
  leaveRequests: LeaveRequestRow[];
  hrCases: HrCaseRow[];
  exceptions: ExceptionRow[];
  payrollHours: PayrollHoursRow[];
}) {
  const pendingLeave = leaveRequests.filter((item) => item.status === "pending").length;

  const openHrCases = hrCases.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "closed" && status !== "resolved";
  }).length;

  const openExceptions = exceptions.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "resolved" && status !== "closed";
  }).length;

  const payrollBlockers = payrollHours.filter((row) => {
    return (
      Number(row.missing_clock_events || 0) > 0 ||
      Number(row.late_minutes || 0) > 0
    );
  }).length;

  return {
    pendingLeave,
    openHrCases,
    openExceptions,
    payrollBlockers,
    total:
      pendingLeave +
      openHrCases +
      openExceptions +
      payrollBlockers,
  };
}

function WhatsAppQueueBadge({
  count,
}: {
  count: number;
}) {
  if (!count || count <= 0) return null;

  return (
    <span className="ml-auto inline-flex min-w-7 items-center justify-center rounded-full bg-rose-500 px-2 py-1 text-[10px] font-black text-white shadow-lg shadow-rose-500/30">
      {count}
    </span>
  );
}

'@

if ($content -notmatch "function getWhatsAppPendingCounts") {
  $content = $content.Replace(
    "`nfunction EmptyWorkAreaScreen",
    "`n$helpers`nfunction EmptyWorkAreaScreen"
  )
}

$needle = 'const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);'

$replacement = @'
const payrollBlockers = payrollHours.filter(rowHasPayrollProblem);

  const whatsappCounts = getWhatsAppPendingCounts({
    leaveRequests,
    hrCases,
    exceptions,
    payrollHours,
  });
'@

$content = $content.Replace($needle, $replacement)

$content = $content.Replace(
    '<div className="text-xs font-black uppercase tracking-[0.3em] text-rose-600">HR Cases</div>',
    '<div className="flex items-center gap-2"><div className="text-xs font-black uppercase tracking-[0.3em] text-rose-600">HR Cases</div><WhatsAppQueueBadge count={whatsappCounts.openHrCases} /></div>'
)

$content = $content.Replace(
    '<div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-600">Leave</div>',
    '<div className="flex items-center gap-2"><div className="text-xs font-black uppercase tracking-[0.3em] text-emerald-600">Leave</div><WhatsAppQueueBadge count={whatsappCounts.pendingLeave} /></div>'
)

$content = $content.Replace(
    '<div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-600">Payroll</div>',
    '<div className="flex items-center gap-2"><div className="text-xs font-black uppercase tracking-[0.3em] text-cyan-600">Payroll</div><WhatsAppQueueBadge count={whatsappCounts.payrollBlockers} /></div>'
)

if ($content -notmatch "const whatsappSidebarCounts = getWhatsAppPendingCounts") {

$sidebarCounts = @'

  const whatsappSidebarCounts = getWhatsAppPendingCounts({
    leaveRequests,
    hrCases,
    exceptions,
    payrollHours,
  });

'@

$content = $content.Replace(
'  const sidebarSections = [',
$sidebarCounts + "`r`n" + '  const sidebarSections = ['
)

}

$sidebarOld = """                      <span className="truncate">{item}</span>"""

$sidebarNew = """                      <span className="truncate">{item}</span>

                      {(item === "WhatsApp Action Centre" ||
                        item === "Notifications" ||
                        item === "Employee Notifications") && (
                        <WhatsAppQueueBadge count={whatsappSidebarCounts.total} />
                      )}

                      {item === "Warnings" && (
                        <WhatsAppQueueBadge count={whatsappSidebarCounts.openHrCases} />
                      )}

                      {item === "Leave Management" && (
                        <WhatsAppQueueBadge count={whatsappSidebarCounts.pendingLeave} />
                      )}

                      {item === "Payroll Prep" && (
                        <WhatsAppQueueBadge count={whatsappSidebarCounts.payrollBlockers} />
                      )}"""

$content = $content.Replace($sidebarOld, $sidebarNew)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "WhatsApp queue badge system installed."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
