$ErrorActionPreference = "Stop"

$path = "C:\Users\humres\vyron-core-web\app\page.tsx"

if (!(Test-Path $path)) {
  throw "Could not find: $path"
}

$content = Get-Content $path -Raw

$uploadComponents = @'

function HrDocumentUploadButton({
  employee,
  documentType,
  label,
  onUploaded,
}: {
  employee: EmployeeRow;
  documentType: string;
  label: string;
  onUploaded?: () => void;
}) {
  const inputId = `hr-upload-${documentType}-${employee.id}`;
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = `${employee.id}/${documentType}/${Date.now()}-${safeName}`;

    const uploadResult = await supabase.storage
      .from("hr-documents")
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadResult.error) {
      setMessage(`Upload failed: ${uploadResult.error.message}`);
      setUploading(false);
      event.target.value = "";
      return;
    }

    const employeeName = getEmployeeDisplayName(employee);

    const insertResult = await supabase.from("hr_documents").insert({
      employee_id: employee.id,
      employee_name: employeeName,
      document_type: documentType,
      document_title: file.name,
      document_notes: null,
      file_name: file.name,
      file_bucket: "hr-documents",
      file_path: filePath,
      status: "active",
      uploaded_by: null,
    });

    if (insertResult.error) {
      setMessage(`File uploaded but record failed: ${insertResult.error.message}`);
      setUploading(false);
      event.target.value = "";
      return;
    }

    setMessage("Uploaded");
    setUploading(false);
    event.target.value = "";
    if (onUploaded) onUploaded();
  }

  return (
    <div>
      <input
        id={inputId}
        type="file"
        className="hidden"
        onChange={handleFile}
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
      />

      <label
        htmlFor={inputId}
        className={`inline-flex cursor-pointer rounded-2xl px-4 py-2 text-sm font-black shadow-lg ${
          documentType === "contract"
            ? "bg-slate-950 text-cyan-300 shadow-cyan-950/15"
            : "bg-cyan-500 text-white shadow-cyan-500/20"
        }`}
      >
        {uploading ? "Uploading..." : label}
      </label>

      {message && (
        <div className="mt-2 text-xs font-bold text-slate-500">{message}</div>
      )}
    </div>
  );
}

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
  const filtered = documents.filter((document) => {
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
                {document.document_type || "general"} · {niceDateTime(document.created_at)}
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

if ($content -notmatch "function HrDocumentUploadButton") {
  $content = $content.Replace("`nfunction EmptyWorkAreaScreen", "`n$uploadComponents`nfunction EmptyWorkAreaScreen")
}

$content = $content.Replace(
'function ContractsCentrePageV2({
  employees,
  setActive
}: {
  employees: EmployeeRow[];
  setActive: (value: string) => void;
}) {',
'function ContractsCentrePageV2({
  employees,
  hrDocuments,
  setActive
}: {
  employees: EmployeeRow[];
  hrDocuments: HrDocumentRow[];
  setActive: (value: string) => void;
}) {'
)

$content = $content.Replace(
'function DocumentsCentrePageV2({
  employees,
  hrCases,
  leaveRequests,
  setActive
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  leaveRequests: LeaveRequestRow[];
  setActive: (value: string) => void;
}) {',
'function DocumentsCentrePageV2({
  employees,
  hrCases,
  leaveRequests,
  hrDocuments,
  setActive
}: {
  employees: EmployeeRow[];
  hrCases: HrCaseRow[];
  leaveRequests: LeaveRequestRow[];
  hrDocuments: HrDocumentRow[];
  setActive: (value: string) => void;
}) {'
)

$content = $content.Replace(
'return <ContractsCentrePageV2 employees={employees} setActive={setActive} />;',
'return <ContractsCentrePageV2 employees={employees} hrDocuments={hrDocuments} setActive={setActive} />;'
)

$content = $content.Replace(
'return <DocumentsCentrePageV2 employees={employees} hrCases={hrCases} leaveRequests={leaveRequests} setActive={setActive} />;',
'return <DocumentsCentrePageV2 employees={employees} hrCases={hrCases} leaveRequests={leaveRequests} hrDocuments={hrDocuments} setActive={setActive} />;'
)

$content = $content.Replace(
'<button className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">' + "`r`n" + '            Upload contract' + "`r`n" + '          </button>',
'{employees[0] && <HrDocumentUploadButton employee={employees[0]} documentType="contract" label="Upload contract" onUploaded={() => window.location.reload()} />}'
)

$content = $content.Replace(
'<button className="rounded-2xl bg-[#06101f] px-5 py-3 text-sm font-black text-cyan-300 shadow-lg shadow-cyan-950/15">' + "`r`n" + '            Upload document' + "`r`n" + '          </button>',
'{employees[0] && <HrDocumentUploadButton employee={employees[0]} documentType="general" label="Upload document" onUploaded={() => window.location.reload()} />}'
)

$content = $content.Replace(
'<button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">Upload Contract</button>',
'<HrDocumentUploadButton employee={employee} documentType="contract" label="Upload Contract" onUploaded={() => window.location.reload()} />'
)

$content = $content.Replace(
'<button className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-black text-cyan-300">Upload Document</button>',
'<HrDocumentUploadButton employee={employee} documentType="general" label="Upload Document" onUploaded={() => window.location.reload()} />'
)

Set-Content -Path $path -Value $content -Encoding UTF8

Write-Host ""
Write-Host "HR document upload pack applied."
Write-Host ""
Write-Host "IMPORTANT: Run SQL/hr-document-upload-schema.sql in Supabase first if not done."
Write-Host ""
Write-Host "Restart:"
Write-Host "cd C:\Users\humres\vyron-core-web"
Write-Host "taskkill /IM node.exe /F"
Write-Host "Remove-Item .next -Recurse -Force"
Write-Host "npm run dev"
