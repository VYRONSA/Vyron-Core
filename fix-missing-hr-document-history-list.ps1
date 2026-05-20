$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$helper = @'

async function openHrDocumentFile(filePath: string | null | undefined) {
  if (!filePath) {
    alert("No file path saved for this document.");
    return;
  }

  const result = await supabase.storage
    .from("hr-documents")
    .createSignedUrl(filePath, 60 * 10);

  if (result.error || !result.data?.signedUrl) {
    alert(result.error?.message || "Could not open file.");
    return;
  }

  window.open(result.data.signedUrl, "_blank");
}

function HrDocumentHistoryList({
  documents,
  employeeId,
  documentType,
}: {
  documents: HrDocumentRow[];
  employeeId: string;
  documentType?: string;
}) {
  const filtered = (documents || []).filter((document) => {
    if (String(document.employee_id || "") !== String(employeeId)) return false;
    if (documentType && document.document_type !== documentType) return false;
    return document.status !== "archived";
  });

  if (filtered.length === 0) {
    return (
      <div className="rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
        No uploaded files yet.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {filtered.slice(0, 8).map((document) => (
        <button
          key={document.id}
          type="button"
          onClick={() => openHrDocumentFile(document.file_path)}
          className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-200"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-black text-slate-950">
                {document.document_title || document.file_name || "HR document"}
              </div>
              <div className="mt-1 text-xs font-bold text-slate-500">
                {(document.document_type || "general")} · {niceDateTime(document.created_at)}
              </div>
            </div>
            <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">
              Open
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

'@

if ($content -notmatch "function HrDocumentHistoryList") {
  $content = $content.Replace("`nfunction EmployeeHrFileDrilldownCentre", "`n$helper`nfunction EmployeeHrFileDrilldownCentre")
}

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host "Missing HrDocumentHistoryList helper added."
