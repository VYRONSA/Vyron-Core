$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

# Force all HR outgoing manager feedback saves away from employee_response.
$content = $content -replace 'employee_response:\s*feedbackById\[[^\]]+\]\s*\|\|\s*"Case reviewed by management\.",', 'manager_feedback: feedbackById[hrCase.id] || "Case reviewed by management.",'
$content = $content -replace 'employee_response:\s*feedback\.trim\(\)\s*\|\|\s*"Case reviewed by management\.",', 'manager_feedback: feedback.trim() || "Case reviewed by management.",'
$content = $content -replace 'employee_response:\s*feedback\s*\|\|\s*"Case reviewed by management\.",', 'manager_feedback: feedback || "Case reviewed by management.",'

# Keep employee_response for inbound WhatsApp only.
$content = $content -replace 'employee_response_required:\s*false,\s*manager_feedback:', 'employee_response_required: true,`r`n          manager_feedback:'

# Ensure manager_feedback is selected anywhere HR cases are selected.
$content = $content.Replace(
  "employee_response, employee_response_required, validity_status",
  "employee_response, employee_response_required, validity_status, manager_feedback"
)

# Prevent duplicate manager_feedback in select strings.
$content = $content.Replace("manager_feedback, manager_feedback", "manager_feedback")

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "Future HR manager feedback save logic corrected."
Write-Host "Now run the SQL cleanup file in Supabase to clean existing mixed data."
