"use client";
import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCcw } from "lucide-react";
export default function PayrollHardeningCentre() {
  const [data,setData]=useState<any>(null); const [error,setError]=useState<string|null>(null); const [loading,setLoading]=useState(false);
  async function load(){setLoading(true);setError(null);try{const r=await fetch("/api/payroll/preflight");const j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||"Preflight failed");setData(j);}catch(e:any){setError(e?.message||"Preflight failed")}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  const blocked=data?.status==="blocked";
  return <section className="space-y-6">
    <div className="rounded-[34px] bg-gradient-to-r from-[#07101f] to-[#0b1a33] p-7 text-white shadow-2xl">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><div className="text-xs font-black uppercase tracking-[0.4em] text-cyan-300">PAYROLL CONTROL</div><h1 className="mt-3 text-4xl font-black">Payroll Readiness Engine</h1><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">Blocks payroll export until clocking, exceptions and HR risks are resolved.</p></div><button onClick={load} className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-slate-950"><RefreshCcw className="mr-2 inline h-4 w-4"/>Refresh</button></div>
    </div>
    {error && <div className="rounded-2xl bg-rose-50 p-4 text-sm font-bold text-rose-700">{error}</div>}
    <div className="grid gap-5 md:grid-cols-5">
      <Metric label="Readiness" value={loading?"...":`${data?.readinessScore??0}%`} danger={blocked}/>
      <Metric label="Open exceptions" value={data?.openExceptions??0} danger={(data?.openExceptions??0)>0}/>
      <Metric label="Open HR cases" value={data?.openHrCases??0} danger={(data?.openHrCases??0)>0}/>
      <Metric label="Missing clocks" value={data?.missingClockEvents??0} danger={(data?.missingClockEvents??0)>0}/>
      <Metric label="Payroll blockers" value={data?.blockedPayroll??0} danger={(data?.blockedPayroll??0)>0}/>
    </div>
    <div className="rounded-[34px] bg-white p-6 shadow-lg">{blocked?<AlertTriangle className="h-8 w-8 text-rose-700"/>:<CheckCircle2 className="h-8 w-8 text-emerald-700"/>}<h2 className="mt-3 text-2xl font-black text-slate-950">{blocked?"Payroll export blocked":"Payroll export ready"}</h2></div>
  </section>
}
function Metric({label,value,danger}:{label:string;value:any;danger?:boolean}){return <div className={`rounded-[28px] p-6 shadow-lg ${danger?"bg-rose-50 text-rose-800":"bg-white text-slate-950"}`}><div className="text-xs font-black uppercase tracking-[0.2em] opacity-70">{label}</div><div className="mt-4 text-4xl font-black">{value}</div></div>}
