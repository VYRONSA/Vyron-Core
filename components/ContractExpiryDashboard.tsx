"use client";
import React from "react";
export default function ContractExpiryDashboard({employeeDocuments=[]}:any){
 const expiring=employeeDocuments.filter((d:any)=>d.expiry_date && Math.ceil((new Date(d.expiry_date).getTime()-Date.now())/86400000)<=30).length;
 return <section className="space-y-6"><div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white"><div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">CONTRACT RISK</div><h1 className="mt-3 text-4xl font-black">Contract Expiry Dashboard</h1></div><div className="grid gap-5 md:grid-cols-3"><Card label="Documents" value={employeeDocuments.length}/><Card label="Expiring / expired" value={expiring}/><Card label="Clean" value={Math.max(0,employeeDocuments.length-expiring)}/></div></section>
}
function Card({label,value}:any){return <div className="rounded-[28px] bg-white p-6 shadow-lg"><div className="text-4xl font-black">{value}</div><div className="text-sm font-bold text-slate-500">{label}</div></div>}
