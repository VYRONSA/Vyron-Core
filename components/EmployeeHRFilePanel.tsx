"use client";
import React,{useState} from "react";
export default function EmployeeHRFilePanel({employees=[],employeeDocuments=[],hrCases=[],leaveRequests=[]}:any){
 const [employeeId,setEmployeeId]=useState(employees[0]?.id||"");
 const e=employees.find((x:any)=>x.id===employeeId)||employees[0];
 const docs=employeeDocuments.filter((d:any)=>d.employee_id===e?.id);
 return <section className="space-y-6"><div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white"><div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">EMPLOYEE HR FILE</div><h1 className="mt-3 text-4xl font-black">Employee HR File</h1></div><div className="rounded-[34px] bg-white p-6 shadow-lg"><select value={e?.id||""} onChange={ev=>setEmployeeId(ev.target.value)} className="w-full rounded-2xl bg-slate-50 px-4 py-3 font-bold">{employees.map((x:any)=><option key={x.id} value={x.id}>{x.first_name} {x.last_name}</option>)}</select></div><div className="rounded-[34px] bg-white p-6 shadow-lg">{docs.length===0?<div className="font-bold text-slate-500">No documents on file.</div>:docs.map((d:any)=><div key={d.id} className="mb-3 rounded-2xl bg-slate-50 p-4"><div className="font-black">{d.document_title}</div>{d.file_url&&<a className="mt-3 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white" href={d.file_url} target="_blank">Open document</a>}</div>)}</div></section>
}
