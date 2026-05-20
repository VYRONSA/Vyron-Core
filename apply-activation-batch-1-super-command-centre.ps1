$ErrorActionPreference = "Stop"
$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find app/page.tsx"
}

$content = Get-Content $path -Raw

if ($content -notmatch 'SuperCommandCentrePanel') {
  $content = $content -replace 'import CommercialDemoEnvironmentFinal from "../components/CommercialDemoEnvironmentFinal";', 'import CommercialDemoEnvironmentFinal from "../components/CommercialDemoEnvironmentFinal";' + "`r`n" + 'import SuperCommandCentrePanel from "../components/SuperCommandCentrePanel";'
}

$block = @'
    if (active === "Dashboard" || active === "Command Centre" || active === "Super Dashboard") {
      return (
        <SuperCommandCentrePanel
          employees={employees}
          stores={stores}
          exceptions={exceptions}
          hrCases={hrCases}
          payrollHours={payrollHours}
          payrollClockChecks={payrollClockChecks}
          leaveRequests={leaveRequests}
          hrWarnings={hrWarnings}
          employeeDocuments={employeeDocuments}
        />
      );
    }

'@

if ($content -match 'function renderSection\(\) \{') {
  $content = $content -replace 'function renderSection\(\) \{', "function renderSection() {`r`n$block"
} else {
  throw "Could not find renderSection function."
}

Set-Content -Path $path -Value $content -Encoding UTF8
Write-Host "Activation Batch 1 applied successfully."
