$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"

if (!(Test-Path $root)) {
  throw "Project folder not found: $root"
}

$files = Get-ChildItem $root -Recurse -Include *.tsx,*.ts | Where-Object {
  $_.FullName -notlike "*\.next\*" -and
  $_.FullName -notlike "*\node_modules\*"
}

$changed = 0

foreach ($file in $files) {
  $content = Get-Content $file.FullName -Raw
  $original = $content

  if ($content -match 'employee_notifications') {
    $content = [regex]::Replace(
      $content,
      '\.from\("employee_notifications"\)\s*\.select\(`[\s\S]*?`\)',
      '.from("employee_notifications").select("*")'
    )

    $content = [regex]::Replace(
      $content,
      "\.from\('employee_notifications'\)\s*\.select\(`[\s\S]*?`\)",
      ".from('employee_notifications').select('*')"
    )

    $content = [regex]::Replace(
      $content,
      '\.from\("employee_notifications"\)\s*\.select\("[\s\S]*?"\)',
      '.from("employee_notifications").select("*")'
    )

    $content = [regex]::Replace(
      $content,
      "\.from\('employee_notifications'\)\s*\.select\('[\s\S]*?'\)",
      ".from('employee_notifications').select('*')"
    )

    $content = $content.Replace("notification.notification_type", "(notification.notification_type || notification.type || 'general')")
    $content = $content.Replace("item.notification_type", "(item.notification_type || item.type || 'general')")
    $content = $content.Replace("row.notification_type", "(row.notification_type || row.type || 'general')")

    if ($content -ne $original) {
      Set-Content -Path $file.FullName -Value $content -Encoding UTF8
      Write-Host "Patched notification query in: $($file.FullName)"
      $changed++
    }
  }
}

Write-Host ""
Write-Host "Notification query patch complete. Files changed: $changed"
Write-Host ""
Write-Host "Now restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
