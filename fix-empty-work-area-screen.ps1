$ErrorActionPreference = "Stop"

$filePath = "C:\Users\humres\vyron-core-web\app\app-page.tsx"

if (!(Test-Path $filePath)) {
  throw "File not found: $filePath"
}

$content = Get-Content $filePath -Raw

if ($content -match "function\s+EmptyWorkAreaScreen\s*\(") {
  Write-Host "EmptyWorkAreaScreen already exists."
  exit 0
}

$screen = @'

function EmptyWorkAreaScreen({
  title,
  setActive,
}: {
  title: string;
  setActive: (value: string) => void;
}) {
  return (
    <Panel>
      <div className="py-12 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-[#06101f] text-cyan-300 shadow-lg shadow-cyan-950/15">
          <Zap className="h-7 w-7" />
        </div>

        <h2 className="mt-6 text-3xl font-black tracking-tight text-slate-950">
          {title}
        </h2>

        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-500">
          This workspace is registered in the navigation but does not have a dedicated live screen yet.
        </p>

        <button
          onClick={() => setActive("Command Centre")}
          className="mt-6 rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15"
        >
          Back to Command Centre
        </button>
      </div>
    </Panel>
  );
}

'@

$marker = "`n`nexport default function"

if ($content.Contains($marker)) {
  $content = $content.Replace($marker, "`n" + $screen + $marker)
} else {
  throw "Could not find export default function marker in app-page.tsx"
}

Set-Content -Path $filePath -Value $content -Encoding UTF8

Write-Host "Fixed missing EmptyWorkAreaScreen in:"
Write-Host $filePath
Write-Host ""
Write-Host "Now run:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "npm run build"
