$ErrorActionPreference = "Stop"

$files = @(
  "C:\Users\humres\vyron-core-web\app\page.tsx",
  "C:\Users\humres\vyron-core-web\app\app-page.tsx"
)

foreach ($filePath in $files) {
  if (!(Test-Path $filePath)) {
    Write-Host "Skipping missing file: $filePath"
    continue
  }

  $content = Get-Content $filePath -Raw

  # Fix hrCase nullable build errors.
  $content = $content.Replace('.eq("id", hrCase.id);', '.eq("id", hrCase!.id);')

  # Add global display helper if employeeName-style errors appear later.
  if ($content -notmatch "function\s+getEmployeeDisplayName\s*\(") {
    $helper = @'

function getEmployeeDisplayName(employee: any) {
  if (!employee) return "Unknown employee";

  const fullName = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();

  return (
    fullName ||
    employee.employee_number ||
    employee.email ||
    employee.phone ||
    employee.name ||
    "Unknown employee"
  );
}

'@

    $markers = @(
      "function formatCurrency",
      "function safeNumber",
      "export default function"
    )

    foreach ($marker in $markers) {
      if ($content.Contains($marker)) {
        $content = $content.Replace($marker, $helper + $marker)
        break
      }
    }
  }

  # Replace old helper calls globally if they exist.
  $content = $content.Replace("employeeName(", "getEmployeeDisplayName(")

  Set-Content -Path $filePath -Value $content -Encoding UTF8

  Write-Host "Patched common TypeScript build issues in:"
  Write-Host $filePath
}

Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
