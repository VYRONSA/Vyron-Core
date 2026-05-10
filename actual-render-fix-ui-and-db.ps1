$ErrorActionPreference = "Stop"

$root = "C:\Users\humres\vyron-core-web"

$targets = @()
$targets += Get-ChildItem "$root\app" -Include *.tsx,*.ts -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$targets += Get-ChildItem "$root\components" -Include *.tsx,*.ts -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName
$targets += Get-ChildItem "$root\src" -Include *.tsx,*.ts -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName

$targets = $targets | Where-Object {
  $_ -notlike "*\.next\*" -and
  $_ -notlike "*\node_modules\*"
} | Sort-Object -Unique

foreach ($file in $targets) {
  $content = Get-Content $file -Raw
  $original = $content

  # Fix actual rendered sidebar toggle span regardless of what corrupted minus character is inside.
  $content = [regex]::Replace(
    $content,
    '<span className="text-base">\{isOpen \? ".*?" : "\+"\}</span>',
    '<span className="text-base">{isOpen ? "-" : "+"}</span>'
  )

  # Fix any rendered Back button text where garbage appears before Back.
  # This targets JSX text like: >â† Back<, >â† Back<, >Â´ Back<, >ã Back<, etc.
  $content = [regex]::Replace(
    $content,
    '>\s*[^<>{}`r`n]{0,50}\sBack\s*<',
    '>Back<'
  )

  # Fix common corruption fragments anywhere in visible text.
  $content = $content.Replace('â†', '')
  $content = $content.Replace('â†�', '')
  $content = $content.Replace('â†’', '→')
  $content = $content.Replace('†’', '→')
  $content = $content.Replace('âˆ’', '-')
  $content = $content.Replace('ˆ’', '-')
  $content = $content.Replace('â€“', '–')
  $content = $content.Replace('€“', '–')
  $content = $content.Replace('â€”', '—')
  $content = $content.Replace('Â·', '·')
  $content = $content.Replace('Â ', ' ')
  $content = $content.Replace('Â', '')
  $content = $content.Replace('š ï¸', '⚠️')
  $content = $content.Replace('ï¸', '')

  # Fix the visible login helper sentence if it contains corruption.
  $content = [regex]::Replace(
    $content,
    'Use the email that was added under Settings / Roles\s*.*?\s*Company Users\.',
    'Use the email that was added under Settings / Roles → Company Users.'
  )

  # Temporary DB compatibility fix:
  # Your production employees table currently has store_id, not default_store_id.
  # This keeps the app working without breaking local logic.
  $content = $content.Replace('default_store_id', 'store_id')

  if ($content -ne $original) {
    Set-Content -Path $file -Value $content -Encoding UTF8
    Write-Host "Patched: $file"
  }
}

Write-Host ""
Write-Host "CHECKING FOR REMAINING PROBLEM STRINGS..."
$remaining = @()
foreach ($file in $targets) {
  $hit = Select-String -Path $file -Pattern 'â|Â|ˆ|†|š|ï¸|Back<' -AllMatches -ErrorAction SilentlyContinue
  if ($hit) { $remaining += $hit }
}

if ($remaining.Count -gt 0) {
  Write-Host ""
  Write-Host "Remaining possible matches found:"
  $remaining | Select-Object Path, LineNumber, Line | Format-List
} else {
  Write-Host "No obvious corrupted UI strings remain."
}

Write-Host ""
Write-Host "NOW RUN:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
