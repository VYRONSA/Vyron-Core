$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$old = 'if (active === "Command Centre") return <ConnectedDashboardScreen stores={stores} employees={employees} exceptions={exceptions} hrCases={hrCases} payrollHours={payrollHours} payrollClockChecks={payrollClockChecks} leaveRequests={leaveRequests} setActive={setActive} onRefresh={refreshData} />;'

$new = 'if (active === "Command Centre") return <VyronCoreCostStyleCommandCentre stores={stores} employees={employees} exceptions={exceptions} hrCases={hrCases} onRefresh={refreshData} companyId={currentCompanyId} />;'

if ($content.Contains($old)) {
  $content = $content.Replace($old, $new)
  Set-Content -Path $path -Value $content -Encoding UTF8
  Write-Host "Dashboard restored to original premium VYRON CORE dashboard."
} else {
  Write-Host "Could not find ConnectedDashboardScreen route. Checking if original dashboard is already active..."
  if ($content.Contains($new)) {
    Write-Host "Original dashboard route is already active."
  } else {
    Write-Host "Manual check needed: Command Centre route pattern was different."
  }
}

Write-Host ""
Write-Host "Now restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
