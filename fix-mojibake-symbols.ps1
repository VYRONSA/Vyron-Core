$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"

$files = @(
  "$root\app\page.tsx",
  "$root\app\app-page.tsx"
)

$componentFiles = Get-ChildItem "$root\components" -Filter "*.tsx" -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$files = $files + $componentFiles

$replacements = @{
  "â†�" = "←"
  "â†’" = "→"
  "â€“" = "–"
  "â€”" = "—"
  "â€˜" = "'"
  "â€™" = "'"
  "â€œ" = '"'
  "â€" = '"'
  "â€¦" = "…"
  "â€¢" = "•"
  "Â·" = "·"
  "Â " = " "
  "Â+" = "+"
  "Â-" = "-"
  "Â−" = "−"
  "Â×" = "×"
  "Â✓" = "✓"
  "Â" = ""
}

foreach ($file in $files) {
  if (!(Test-Path $file)) { continue }

  $content = Get-Content $file -Raw
  $original = $content

  foreach ($key in $replacements.Keys) {
    $content = $content.Replace($key, $replacements[$key])
  }

  if ($content -ne $original) {
    Set-Content -Path $file -Value $content -Encoding UTF8
    Write-Host "Fixed symbols in: $file"
  }
}

Write-Host ""
Write-Host "Done. Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
