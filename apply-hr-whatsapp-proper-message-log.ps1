$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"
$pagePath = Join-Path $root "app\page.tsx"

if (!(Test-Path $root)) {
  throw "Could not find project folder: $root"
}

# Write proper server routes.
$route1 = Join-Path $root "app\api\whatsapp\webhook"
$route2 = Join-Path $root "app\api\hr-cases\whatsapp-action"

New-Item -ItemType Directory -Force -Path $route1 | Out-Null
New-Item -ItemType Directory -Force -Path $route2 | Out-Null

Copy-Item -Path ".\app\api\whatsapp\webhook\route.ts" -Destination (Join-Path $route1 "route.ts") -Force
Copy-Item -Path ".\app\api\hr-cases\whatsapp-action\route.ts" -Destination (Join-Path $route2 "route.ts") -Force

# Patch HR page action logic enough to use new server route if the existing function body is discoverable.
if (Test-Path $pagePath) {
  $content = Get-Content $pagePath -Raw

  # Keep outgoing manager feedback out of employee_response.
  $content = $content -replace 'employee_response:\s*feedback\.trim\(\)\s*\|\|\s*"Case reviewed by management\.",', 'manager_feedback: feedback.trim() || "Case reviewed by management.",'
  $content = $content -replace 'employee_response:\s*feedback\s*\|\|\s*"Case reviewed by management\.",', 'manager_feedback: feedback || "Case reviewed by management.",'
  $content = $content -replace 'employee_response_required:\s*false,\s*manager_feedback:', 'employee_response_required: true,`r`n          manager_feedback:'

  # Ensure labels are present.
  if ($content -notmatch "Last manager WhatsApp message") {
    $employeeText = "Employee WhatsApp reply / response"
    $idx = $content.IndexOf($employeeText)
    if ($idx -gt 0) {
      $insertAt = $content.LastIndexOf('<div className="mt-3 rounded-2xl', $idx)
      if ($insertAt -gt 0) {
        $managerSection = @'
                      <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <div className="text-xs font-black uppercase tracking-[0.25em] text-slate-500">
                          Last manager WhatsApp message
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                          {hrCase.manager_feedback || "No manager WhatsApp message saved yet."}
                        </div>
                      </div>

'@
        $content = $content.Substring(0, $insertAt) + $managerSection + $content.Substring($insertAt)
      }
    }
  }

  # Ensure manager_feedback in select strings where possible.
  $content = $content.Replace(
    "employee_response, employee_response_required, validity_status",
    "employee_response, employee_response_required, validity_status, manager_feedback"
  )
  $content = $content.Replace("manager_feedback, manager_feedback", "manager_feedback")

  Set-Content -Path $pagePath -Value $content -Encoding UTF8
}

Write-Host ""
Write-Host "VYRON CORE HR WhatsApp proper message log installed."
Write-Host ""
Write-Host "Routes installed:"
Write-Host "- app/api/whatsapp/webhook/route.ts"
Write-Host "- app/api/hr-cases/whatsapp-action/route.ts"
Write-Host ""
Write-Host "Next:"
Write-Host "1. Run SQL in Supabase: sql\hr_whatsapp_proper_message_log.sql"
Write-Host "2. Restart npm run dev."
