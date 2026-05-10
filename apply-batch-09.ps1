$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

$content = $content.Replace(
'const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});',
'const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
  Main: true,
  Operations: false,
  Advanced: false,
  "Owner Tools": false,
});'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Batch 09 complete: sidebar groups collapse by default."
