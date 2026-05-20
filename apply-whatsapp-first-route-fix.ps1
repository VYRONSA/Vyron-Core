$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

if ($content -notmatch "function WhatsAppActionCentreLive") {
  throw "WhatsAppActionCentreLive not found. Re-run the WhatsApp engine pack first."
}

# Prevent duplicate insertion.
$content = $content.Replace("/* VYRON_WHATSAPP_FIRST_ROUTE_START */", "/* OLD_VYRON_WHATSAPP_FIRST_ROUTE_START */")
$content = $content.Replace("/* VYRON_WHATSAPP_FIRST_ROUTE_END */", "/* OLD_VYRON_WHATSAPP_FIRST_ROUTE_END */")

$routeBlock = @'
/* VYRON_WHATSAPP_FIRST_ROUTE_START */
    if (
      active === "Employee Notifications" ||
      active === "Notifications" ||
      active === "WhatsApp" ||
      active === "WhatsApp Action Centre"
    ) {
      return (
        <WhatsAppActionCentreLive
          employees={employees}
          leaveRequests={leaveRequests}
          hrCases={hrCases}
          payrollHours={payrollHours}
          setActive={setActive}
        />
      );
    }
/* VYRON_WHATSAPP_FIRST_ROUTE_END */

'@

# Insert as the first logic inside renderSection / renderScreen / renderActiveScreen.
$inserted = $false

$patterns = @(
  'const renderSection = \(\) => \{\s*',
  'function renderSection\(\) \{\s*',
  'const renderScreen = \(\) => \{\s*',
  'function renderScreen\(\) \{\s*',
  'const renderActiveScreen = \(\) => \{\s*',
  'function renderActiveScreen\(\) \{\s*'
)

foreach ($pattern in $patterns) {
  if (!$inserted -and $content -match $pattern) {
    $content = [regex]::Replace(
      $content,
      $pattern,
      { param($m) $m.Value + "`r`n" + $routeBlock },
      1
    )
    $inserted = $true
  }
}

if (!$inserted) {
  throw "Could not find renderSection/renderScreen function to insert WhatsApp first-route."
}

# Make sidebar/buttons target the new exact route name.
$content = $content.Replace('setActive("Employee Notifications")', 'setActive("WhatsApp Action Centre")')
$content = $content.Replace('setActive("Notifications")', 'setActive("WhatsApp Action Centre")')
$content = $content.Replace('setActive("WhatsApp")', 'setActive("WhatsApp Action Centre")')

# Clean old inserted route markers if present, but leave old code harmless.
$content = $content.Replace("/* OLD_VYRON_WHATSAPP_FIRST_ROUTE_START */", "")
$content = $content.Replace("/* OLD_VYRON_WHATSAPP_FIRST_ROUTE_END */", "")

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "WhatsApp FIRST route fix applied."
Write-Host "WhatsApp route is now first inside the render function, so the old Notification Queue cannot win first."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
