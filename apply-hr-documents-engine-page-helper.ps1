$ErrorActionPreference = "Stop"
$path = "C:\Users\humres\vyron-core-web\app\page.tsx"
$content = Get-Content $path -Raw

if ($content -notmatch 'HRDocumentsEnginePanel') {
  $content = $content -replace 'import ContractCentrePanel from "../components/ContractCentrePanel";', 'import ContractCentrePanel from "../components/ContractCentrePanel";`r`nimport HRDocumentsEnginePanel from "../components/HRDocumentsEnginePanel";'
}

$content = $content -replace '"Contracts",\s*"Documents",\s*"Employee HR File",', '"HR Documents",'
$content = $content -replace 'if \(active === "Contracts"\) return <ContractCentrePanel employees=\{employees\} employeeDocuments=\{employeeDocuments\} companyId=\{currentCompanyId\} onUpdated=\{refreshData\} />;', 'if (active === "HR Documents") return <HRDocumentsEnginePanel employees={employees} employeeDocuments={employeeDocuments} documentCategories={documentCategories} companyId={currentCompanyId} onUpdated={refreshData} />;'

if ($content -notmatch 'documentCategories, setDocumentCategories') {
  $content = $content -replace 'const \[employeeDocuments, setEmployeeDocuments\] = useState<EmployeeDocumentRow\[\]>\(\[\]\);', 'const [employeeDocuments, setEmployeeDocuments] = useState<EmployeeDocumentRow[]>([]);`r`n  const [documentCategories, setDocumentCategories] = useState<any[]>([]);'
}

if ($content -notmatch 'employee_document_categories') {
  $content = $content -replace 'supabase.from\("employee_documents"\).select\("\*"\).eq\("company_id", activeCompanyId\).order\("created_at", \{ ascending: false \}\),', 'supabase.from("employee_documents").select("*").eq("company_id", activeCompanyId).order("created_at", { ascending: false }),`r`n        supabase.from("employee_document_categories").select("*").eq("company_id", activeCompanyId).eq("active", true).order("sort_order", { ascending: true }),'
}

Set-Content -Path $path -Value $content -Encoding UTF8
Write-Host "HR Documents helper patch completed."
