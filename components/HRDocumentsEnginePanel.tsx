"use client";

import React, { useMemo, useState } from "react";
import { Archive, Download, FileText, FolderPlus, Search, Trash2, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";

const fallbackCategories = ["Contracts", "Offer Letters", "Warnings", "Disciplinaries", "Staff Loans", "Job Descriptions", "Increase Letters", "Medical", "Training", "Policies", "Other"];

function employeeName(employee:any){return employee ? `${employee.first_name || ""} ${employee.last_name || ""}`.trim() || employee.employee_number || "Employee" : "Employee";}
function cleanFileSize(value?:number|null){if(!value)return "Unknown size"; if(value<1024)return `${value} B`; if(value<1024*1024)return `${Math.round(value/1024)} KB`; return `${(value/1024/1024).toFixed(2)} MB`;}
function normalise(value:string){return String(value || "").toLowerCase().replaceAll(" ","_");}

export default function HRDocumentsEnginePanel({employees=[], employeeDocuments=[], documentCategories=[], companyId, onUpdated}:any){
  if (!companyId) {
    return (
      <div className="rounded-2xl bg-amber-50 p-5 text-sm font-bold text-amber-800">
        Company context is required before documents can be loaded.
      </div>
    );
  }

  const activeEmployees = employees.filter((e:any)=>e.active !== false);
  const categories = documentCategories.length > 0 ? documentCategories : fallbackCategories.map((name,index)=>({id:name,name,sort_order:index+1,system_category:true}));
  const [selectedEmployeeId,setSelectedEmployeeId]=useState(activeEmployees[0]?.id || "");
  const [selectedCategoryId,setSelectedCategoryId]=useState(categories[0]?.id || "Contracts");
  const [search,setSearch]=useState("");
  const [newCategoryName,setNewCategoryName]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [fileLabel,setFileLabel]=useState("");
  const [notes,setNotes]=useState("");
  const [issueDate,setIssueDate]=useState(new Date().toISOString().slice(0,10));
  const [expiryDate,setExpiryDate]=useState("");
  const [signedStatus,setSignedStatus]=useState("signed");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);

  const selectedEmployee = activeEmployees.find((x:any)=>x.id===selectedEmployeeId);
  const selectedCategory = categories.find((x:any)=>x.id===selectedCategoryId) || categories[0];
  const employeeDocs = useMemo(()=>employeeDocuments.filter((d:any)=>d.employee_id===selectedEmployeeId),[employeeDocuments,selectedEmployeeId]);

  const categoryDocs = useMemo(()=>{
    const term=search.trim().toLowerCase();
    return employeeDocs.filter((doc:any)=>{
      const catName=selectedCategory?.name || selectedCategoryId;
      const categoryMatch = doc.category_id===selectedCategoryId || normalise(doc.document_type)===normalise(catName) || String(doc.document_title||"").toLowerCase().includes(String(catName||"").toLowerCase());
      if(!categoryMatch || doc.status==="archived") return false;
      if(!term) return true;
      return [doc.file_name,doc.document_title,doc.document_notes,doc.employee_name,doc.signed_status,doc.status].join(" ").toLowerCase().includes(term);
    });
  },[employeeDocs,selectedCategoryId,selectedCategory,search]);

  function categoryCount(category:any){
    return employeeDocs.filter((doc:any)=>doc.category_id===category.id || normalise(doc.document_type)===normalise(category.name) || String(doc.document_title||"").toLowerCase().includes(String(category.name||"").toLowerCase())).length;
  }

  async function createCategory(){
    if(!newCategoryName.trim()){setMessage("Enter a category name first."); return;}
    setBusy(true);
    const result=await supabase.from("employee_document_categories").insert({company_id:companyId,name:newCategoryName.trim(),description:"Custom HR document category",color:"slate",icon:"folder",sort_order:500,system_category:false,active:true});
    if(result.error)setMessage(result.error.message); else {setMessage("Category created."); setNewCategoryName(""); if(onUpdated)await onUpdated();}
    setBusy(false);
  }

  async function uploadDocument(){
    if(!selectedEmployee){setMessage("Select an employee first."); return;}
    if(!selectedCategory){setMessage("Select a category first."); return;}
    if(!file){setMessage("Browse and select a file first."); return;}
    setBusy(true); setMessage(null);
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
    const safeCategory=String(selectedCategory.name||"HR File").replace(/[^a-zA-Z0-9._-]/g,"_");
    const path=`${companyId}/${selectedEmployee.id}/${safeCategory}/${Date.now()}-${safeName}`;
    const upload=await supabase.storage.from("employee-documents").upload(path,file,{cacheControl:"3600",upsert:false});
    if(upload.error){setMessage(upload.error.message); setBusy(false); return;}
    const publicUrl=supabase.storage.from("employee-documents").getPublicUrl(path).data.publicUrl;
    const insert=await supabase.from("employee_documents").insert({company_id:companyId,employee_id:selectedEmployee.id,employee_name:employeeName(selectedEmployee),category_id:selectedCategory.id,document_type:normalise(selectedCategory.name||"HR File"),document_title:fileLabel.trim()||String(selectedCategory.name||"HR File"),document_notes:notes.trim()||null,file_name:file.name,file_url:publicUrl,file_bucket:"employee-documents",file_path:path,file_mime_type:file.type||null,file_size_bytes:file.size,issue_date:issueDate||null,expiry_date:expiryDate||null,signed_status:signedStatus,status:"active",uploaded_by:"manager",version_number:1,compliance_required:Boolean(expiryDate),compliance_status:expiryDate?"review_required":"not_required",review_required:Boolean(expiryDate)});
    if(insert.error)setMessage(insert.error.message); else {setMessage("Document uploaded into employee HR file."); setFile(null); setFileLabel(""); setNotes(""); setExpiryDate(""); if(onUpdated)await onUpdated();}
    setBusy(false);
  }

  async function archiveDocument(doc:any){setBusy(true); const result=await supabase.from("employee_documents").update({status:"archived"}).eq("id",doc.id); setMessage(result.error?result.error.message:"Document archived."); if(!result.error&&onUpdated)await onUpdated(); setBusy(false);}
  async function deleteDocument(doc:any){if(!window.confirm("Delete this file permanently?"))return; setBusy(true); if(doc.file_path)await supabase.storage.from("employee-documents").remove([doc.file_path]); const result=await supabase.from("employee_documents").delete().eq("id",doc.id); setMessage(result.error?result.error.message:"Document deleted."); if(!result.error&&onUpdated)await onUpdated(); setBusy(false);}

  return <section className="space-y-6">
    <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl"><div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">HR DOCUMENT ENGINE</div><h1 className="mt-3 text-4xl font-black">Employee HR Documents</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">One HR file per employee. Separate categories inside each employee file.</p></div>
    <div className="grid gap-6 xl:grid-cols-[0.75fr_0.9fr_1.25fr]">
      <div className="rounded-[34px] bg-white p-6 shadow-lg"><h2 className="text-xl font-black text-slate-950">Employees</h2><div className="mt-4 space-y-2">{activeEmployees.map((employee:any)=><button key={employee.id} onClick={()=>setSelectedEmployeeId(employee.id)} className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-black ${selectedEmployeeId===employee.id?"bg-slate-950 text-white":"bg-slate-50 text-slate-700"}`}>{employeeName(employee)}<div className="mt-1 text-xs opacity-70">{employee.employee_number||"No code"}</div></button>)}</div></div>
      <div className="rounded-[34px] bg-white p-6 shadow-lg"><h2 className="text-xl font-black text-slate-950">Categories</h2><div className="mt-4 space-y-2">{categories.map((category:any)=><button key={category.id} onClick={()=>setSelectedCategoryId(category.id)} className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-black ${selectedCategoryId===category.id?"bg-blue-600 text-white":"bg-slate-50 text-slate-700"}`}><span>{category.name}</span><span className="rounded-full bg-white/20 px-2 py-1 text-xs">{categoryCount(category)}</span></button>)}</div><div className="mt-6 rounded-3xl bg-slate-50 p-4"><div className="flex items-center gap-2 text-sm font-black text-slate-700"><FolderPlus className="h-4 w-4"/>Create category</div><input value={newCategoryName} onChange={(e)=>setNewCategoryName(e.target.value)} placeholder="e.g. Company Vehicle" className="mt-3 w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold outline-none"/><button onClick={createCategory} disabled={busy} className="mt-3 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300">Add Category</button></div></div>
      <div className="rounded-[34px] bg-white p-6 shadow-lg"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><h2 className="text-xl font-black text-slate-950">{selectedCategory?.name||"Category"} Documents</h2><p className="mt-1 text-sm font-semibold text-slate-500">{selectedEmployee?employeeName(selectedEmployee):"Select employee"}</p></div><Archive className="h-7 w-7 text-slate-400"/></div>
        <div className="mt-5 rounded-3xl bg-cyan-50 p-4"><div className="mb-3 text-sm font-black text-cyan-900">Upload into this category</div><input value={fileLabel} onChange={(e)=>setFileLabel(e.target.value)} placeholder="Optional label" className="mb-3 w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold outline-none"/><textarea value={notes} onChange={(e)=>setNotes(e.target.value)} placeholder="Notes..." rows={2} className="mb-3 w-full rounded-2xl bg-white px-4 py-3 text-sm font-bold outline-none"/><div className="mb-3 grid gap-3 md:grid-cols-3"><input type="date" value={issueDate} onChange={(e)=>setIssueDate(e.target.value)} className="rounded-2xl bg-white px-4 py-3 text-sm font-bold"/><input type="date" value={expiryDate} onChange={(e)=>setExpiryDate(e.target.value)} className="rounded-2xl bg-white px-4 py-3 text-sm font-bold"/><select value={signedStatus} onChange={(e)=>setSignedStatus(e.target.value)} className="rounded-2xl bg-white px-4 py-3 text-sm font-bold"><option value="signed">Signed</option><option value="unsigned">Unsigned</option><option value="pending_signature">Pending signature</option><option value="not_required">Signature not required</option></select></div><label className="block rounded-[24px] border-2 border-dashed border-cyan-200 bg-white p-4 text-center text-sm font-black text-cyan-900"><Upload className="mx-auto h-7 w-7"/><div className="mt-2">Browse file</div><input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp" onChange={(e)=>setFile(e.target.files?.[0]||null)} className="mt-3 block w-full rounded-2xl bg-slate-50 px-4 py-3 text-sm font-bold"/></label>{file&&<div className="mt-3 rounded-2xl bg-white p-3 text-sm font-bold text-slate-700">Selected: {file.name} · {cleanFileSize(file.size)}</div>}<button onClick={uploadDocument} disabled={busy} className="mt-3 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300">{busy?"Working...":"Upload Document"}</button>{message&&<div className="mt-3 rounded-2xl bg-blue-100 p-3 text-sm font-black text-blue-800">{message}</div>}</div>
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3"><Search className="h-5 w-5 text-slate-400"/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search documents..." className="w-full bg-transparent text-sm font-bold outline-none"/></div>
        <div className="mt-5 space-y-3">{categoryDocs.length===0?<div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center"><FileText className="mx-auto h-10 w-10 text-slate-300"/><div className="mt-3 font-black text-slate-500">No documents in this category.</div></div>:categoryDocs.map((doc:any)=><div key={doc.id} className="rounded-3xl bg-slate-50 p-5"><div className="font-black text-slate-950">{doc.file_name||doc.document_title}</div><div className="mt-1 text-sm font-semibold text-slate-500">{doc.document_title||selectedCategory?.name} · {cleanFileSize(doc.file_size_bytes)}</div><div className="mt-2 text-sm text-slate-600">{doc.document_notes||"No notes."}</div><div className="mt-4 grid gap-3 md:grid-cols-3">{doc.file_url&&<a href={doc.file_url} target="_blank" rel="noreferrer" className="rounded-2xl bg-blue-600 px-4 py-3 text-center text-sm font-black text-white"><Download className="mr-2 inline h-4 w-4"/>Open</a>}<button onClick={()=>archiveDocument(doc)} disabled={busy} className="rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300">Archive</button><button onClick={()=>deleteDocument(doc)} disabled={busy} className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-black text-white disabled:bg-slate-300"><Trash2 className="mr-2 inline h-4 w-4"/>Delete</button></div></div>)}</div>
      </div>
    </div>
  </section>;
}
