$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

if ($content -notmatch "function WhatsAppActionCentreLive") {
  throw "WhatsAppActionCentreLive not found. Upload current page.tsx if this happens."
}

# 1. Restore Leave / Leave Management as approval page, not WhatsApp page.
$content = $content.Replace('Leave: "WhatsApp Action Centre"', 'Leave: "Leave Management"')
$content = $content.Replace('"Leave Management": "WhatsApp Action Centre"', '"Leave Management": "Leave Management"')
$content = $content.Replace('"Leave Approvals": "WhatsApp Action Centre"', '"Leave Approvals": "Leave Management"')

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave"\)[^\n]*return [^;]+;',
  'if (active === "Leave") return <LeaveApprovalsScreen leaveRequests={leaveRequests} employees={employees} onRefresh={refreshData} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave Management"\)[^\n]*return [^;]+;',
  'if (active === "Leave Management") return <LeaveApprovalsScreen leaveRequests={leaveRequests} employees={employees} onRefresh={refreshData} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave Approvals"\)[^\n]*return [^;]+;',
  'if (active === "Leave Approvals") return <LeaveApprovalsScreen leaveRequests={leaveRequests} employees={employees} onRefresh={refreshData} />;'
)

# 2. Add communication-only counter helper.
if ($content -notmatch "function getWhatsAppCommunicationCounts") {
$communicationHelper = @'

function getWhatsAppCommunicationCounts({
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
  const leaveMessages = leaveRequests.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status === "approved" || status === "declined" || status === "amended";
  }).length;

  const hrMessages = hrCases.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "closed" && status !== "resolved";
  }).length;

  const exceptionMessages = exceptions.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    return status !== "closed" && status !== "approved" && status !== "resolved";
  }).length;

  const payrollMessages = payrollHours.filter(rowHasPayrollProblem).length;

  return {
    leaveMessages,
    hrMessages,
    exceptionMessages,
    payrollMessages,
    total: leaveMessages + hrMessages + exceptionMessages + payrollMessages,
  };
}

'@
$content = $content.Replace("`nfunction WhatsAppActionCentreLive", "`n$communicationHelper`nfunction WhatsAppActionCentreLive")
}

# 3. Add communicationCounts inside WhatsAppActionCentreLive.
if ($content -notmatch "const communicationCounts = getWhatsAppCommunicationCounts") {
$content = $content.Replace(
  'const pendingLeave = leaveRequests.filter((item) => item.status === "pending");',
  'const pendingLeave = leaveRequests.filter((item) => item.status === "pending");' + "`r`n" +
  '  const communicationCounts = getWhatsAppCommunicationCounts({ leaveRequests, hrCases, exceptions, payrollHours });'
)
}

# 4. Add clean explanation panel.
$cleanPanel = @'

      <Panel>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-2xl font-black text-slate-950">Communication queue only</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              This page is only for sending WhatsApp messages. Leave approvals stay under Leave. Leave history stays under Leave History. HR case status stays under HR Cases.
            </p>
          </div>
          <div className="rounded-2xl bg-rose-50 px-5 py-4 text-sm font-black text-rose-700">
            {communicationCounts.total} communication action(s)
          </div>
        </div>
      </Panel>

'@

if ($content -notmatch "Communication queue only") {
$content = $content.Replace('<div className="grid gap-5 md:grid-cols-3">', $cleanPanel + "`r`n" + '<div className="grid gap-5 md:grid-cols-3">', 1)
}

# 5. Make WhatsApp centre card counts communication-only where possible.
$content = $content.Replace(
  '<div className="mt-4 text-5xl font-black text-slate-950">{pendingLeave.length}</div>',
  '<div className="mt-4 text-5xl font-black text-slate-950">{communicationCounts.leaveMessages}</div>'
)

$content = $content.Replace(
  '<div className="mt-3 text-4xl font-black">{pendingLeave.length}</div>',
  '<div className="mt-3 text-4xl font-black">{communicationCounts.leaveMessages}</div>'
)

$content = $content.Replace("Leave Pending", "Leave Messages")
$content = $content.Replace(
  "Pending leave requests available for employee feedback.",
  "Approved/declined/amended leave messages ready for employee communication."
)

# 6. Sidebar alert counts: add separate WhatsApp communication count without replacing Leave badge.
if ($content -notmatch "communicationCountsForSidebar") {
$content = $content.Replace(
  '  const alertCounts = useMemo(() => {',
  '  const communicationCountsForSidebar = getWhatsAppCommunicationCounts({ leaveRequests, hrCases, exceptions, payrollHours });' + "`r`n`r`n" +
  '  const alertCounts = useMemo(() => {'
)
}

if ($content -notmatch '"WhatsApp Action Centre": communicationCountsForSidebar.total') {
$content = $content.Replace(
  '      "Staff Leave": pendingLeaveCount,',
  '      "Staff Leave": pendingLeaveCount,' + "`r`n" +
  '      "WhatsApp Action Centre": communicationCountsForSidebar.total,' + "`r`n" +
  '      Notifications: communicationCountsForSidebar.total,' + "`r`n" +
  '      "Employee Notifications": communicationCountsForSidebar.total,'
)
}

$content = $content.Replace(
  '  }, [openExceptionCount, openHrCaseCount, pendingLeaveCount, blockedPayrollCount]);',
  '  }, [openExceptionCount, openHrCaseCount, pendingLeaveCount, blockedPayrollCount, communicationCountsForSidebar.total]);'
)

# 7. Clean confusing text from previous queue-handled patch.
$content = $content.Replace(
  'Communication queue rule: once you send or mark an item as handled here, the WhatsApp red badge clears. The actual HR case, leave record, payroll issue or clocking issue remains in its own module until resolved.',
  'Communication queue rule: this page records communication work only. It does not approve leave, close HR cases, or resolve payroll/clocking issues.'
)
$content = $content.Replace('Mark current WhatsApp queue handled', 'Mark communication reviewed')

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Clean approval vs WhatsApp structure applied."
Write-Host ""
Write-Host "Result:"
Write-Host "- Leave Approvals stays separate for approvals only."
Write-Host "- Leave History stays read-only."
Write-Host "- WhatsApp Action Centre is communication only."
Write-Host "- Red counts are separated per module."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
