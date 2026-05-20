$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

if ($content -notmatch "function WhatsAppActionCentreLive") {
  throw "WhatsAppActionCentreLive not found. Please upload your current page.tsx if this happens."
}

# 1) Make sure WhatsApp Action Centre is listed under Operations.
if ($content -notmatch '"WhatsApp Action Centre"') {
  $content = $content.Replace(
    '      "Notifications",',
    '      "Notifications",' + "`r`n" + '      "WhatsApp Action Centre",'
  )
}

# 2) Make navigation labels/targets route leave approval communication into WhatsApp Action Centre.
# This keeps Leave History untouched.
$navMapTargets = @{
  'Leave Management: "Leave Management"' = 'Leave Management: "WhatsApp Action Centre"'
  '"Leave Management": "Leave Management"' = '"Leave Management": "WhatsApp Action Centre"'
  '"Leave Approvals": "Leave Approvals"' = '"Leave Approvals": "WhatsApp Action Centre"'
  'Leave: "Leave Management"' = 'Leave: "WhatsApp Action Centre"'
  'Leave: "Leave"' = 'Leave: "WhatsApp Action Centre"'
}

foreach ($key in $navMapTargets.Keys) {
  $content = $content.Replace($key, $navMapTargets[$key])
}

# 3) Force old leave approval routes to WhatsApp Action Centre.
$whatsAppReturnSingle = 'if ($1) return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;'

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave Approvals"\)[^\n]*return [^;]+;',
  'if (active === "Leave Approvals") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave Management"\)[^\n]*return [^;]+;',
  'if (active === "Leave Management") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;'
)

$content = [regex]::Replace(
  $content,
  'if \(active === "Leave"\)[^\n]*return [^;]+;',
  'if (active === "Leave") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;'
)

# 4) Make sure WhatsApp Action Centre itself has a route.
if ($content -notmatch 'active === "WhatsApp Action Centre"\)[^\n]*return <WhatsAppActionCentreLive') {
  $content = $content.Replace(
    '    if (active === "Employee Notifications") return <EmployeeNotificationsPanel onUpdated={refreshData} />;',
    '    if (active === "WhatsApp Action Centre") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;' + "`r`n" +
    '    if (active === "Employee Notifications") return <WhatsAppActionCentreLive employees={employees} leaveRequests={leaveRequests} hrCases={hrCases} exceptions={exceptions} payrollHours={payrollHours} setActive={setActive} />;'
  )
}

# 5) Add WhatsApp Action Centre count into alertCounts object.
# Use the app's existing alertCounts system, because the sidebar already reads alertCounts.
if ($content -notmatch '"WhatsApp Action Centre": openExceptionCount') {
  $content = $content.Replace(
    '      "Staff Leave": pendingLeaveCount,',
    '      "Staff Leave": pendingLeaveCount,' + "`r`n`r`n" +
    '      "WhatsApp Action Centre": openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,' + "`r`n" +
    '      Notifications: openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,' + "`r`n" +
    '      "Employee Notifications": openExceptionCount + openHrCaseCount + pendingLeaveCount + blockedPayrollCount,'
  )
}

# 6) Ensure dependency array stays correct. The counts use the same existing dependencies so no change required.
# 7) Replace any buttons that open Leave Approvals/Leave Management with WhatsApp Action Centre for approvals.
$content = $content.Replace('setActive("Leave Approvals")', 'setActive("WhatsApp Action Centre")')
$content = $content.Replace('setActive("Leave Management")', 'setActive("WhatsApp Action Centre")')

# 8) Change ActionHubCard targets if present.
$content = $content.Replace('target="Leave Management"', 'target="WhatsApp Action Centre"')
$content = $content.Replace('target="Leave Approvals"', 'target="WhatsApp Action Centre"')

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Central WhatsApp Action Centre patch applied."
Write-Host ""
Write-Host "Changed:"
Write-Host "- Leave approvals now divert to WhatsApp Action Centre."
Write-Host "- WhatsApp Action Centre uses red sidebar badge count."
Write-Host "- Notifications also route into WhatsApp Action Centre."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
