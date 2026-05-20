$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

if ($content -notmatch "function WhatsAppActionCentreLive") {
  throw "WhatsAppActionCentreLive not found. Re-run the WhatsApp engine pack first."
}

$override = @'
{(
  active === "Employee Notifications" ||
  active === "Notifications" ||
  active === "WhatsApp" ||
  active === "WhatsApp Action Centre"
) ? (
  <WhatsAppActionCentreLive
    employees={employees}
    leaveRequests={leaveRequests}
    hrCases={hrCases}
    payrollHours={payrollHours}
    setActive={setActive}
  />
) : (
  renderSection()
)}
'@

# Remove any previous override marker cleanup.
$content = $content.Replace("{renderSection()}", "__VYRON_RENDER_SECTION_PLACEHOLDER__")

if ($content -notmatch "__VYRON_RENDER_SECTION_PLACEHOLDER__") {
  throw "Could not find {renderSection()} in page.tsx."
}

# Replace only the first renderSection output placeholder.
$content = $content.Replace("__VYRON_RENDER_SECTION_PLACEHOLDER__", $override)

# If multiple placeholders were created, restore the rest.
$content = $content.Replace("__VYRON_RENDER_SECTION_PLACEHOLDER__", "{renderSection()}")

# Make buttons point to the new route name.
$content = $content.Replace('setActive("Employee Notifications")', 'setActive("WhatsApp Action Centre")')
$content = $content.Replace('setActive("Notifications")', 'setActive("WhatsApp Action Centre")')
$content = $content.Replace('setActive("WhatsApp")', 'setActive("WhatsApp Action Centre")')

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "WhatsApp render override applied."
Write-Host "This bypasses the old Notification Queue by wrapping renderSection output."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
