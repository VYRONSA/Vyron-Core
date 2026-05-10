$ErrorActionPreference = "Stop"

$filePath = "C:\Users\humres\vyron-core-web\app\app-page.tsx"

if (!(Test-Path $filePath)) {
  throw "File not found: $filePath"
}

$content = Get-Content $filePath -Raw

$old = '.eq("id", hrCase.id);'
$new = '.eq("id", hrCase!.id);'

if ($content -notlike "*$old*") {
  Write-Host "Exact target was not found. Checking if file is already fixed..."

  if ($content -like "*$new*") {
    Write-Host "Already fixed."
    exit 0
  }

  throw "Could not find the expected TypeScript line to patch: $old"
}

$content = $content.Replace($old, $new)

Set-Content -Path $filePath -Value $content -Encoding UTF8

Write-Host "Fixed hrCase nullable TypeScript build error in:"
Write-Host $filePath
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
