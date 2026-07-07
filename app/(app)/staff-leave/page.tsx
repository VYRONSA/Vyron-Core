"use client";

import { useEffect, useState } from "react";
import { getCompanyAccess } from "@/lib/company-access";
import { supabase } from "@/lib/supabase";
import LeaveApprovalsPanel from "@/components/LeaveApprovalsPanel";
import LeaveBalancePanel from "@/components/LeaveBalancePanel";
import LeaveControlCentrePanel from "@/components/LeaveControlCentrePanel";
import LeaveDecisionAuditPanel from "@/components/LeaveDecisionAuditPanel";
import LeaveManagementExcellencePanel from "@/components/LeaveManagementExcellencePanel";

type LeaveRequestRow = {
	id: string;
	employee_id: string | null;
	employee_name: string | null;
	leave_type: string | null;
	start_date: string;
	end_date: string;
	reason: string | null;
	status: string;
	manager_feedback: string | null;
	created_at: string;
};

type EmployeeRow = {
	id: string;
	first_name: string;
	last_name: string;
};

export default function StaffLeavePage() {
	const [companyId, setCompanyId] = useState("");
	const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
	const [employees, setEmployees] = useState<EmployeeRow[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;

		async function init() {
			const { access } = await getCompanyAccess(supabase);
			if (cancelled || !access?.company_id) return;
			setCompanyId(access.company_id);
			await loadData(access.company_id);
		}

		init();

		return () => {
			cancelled = true;
		};
	}, []);

	async function loadData(activeCompanyId: string) {
		setLoading(true);

		const [leaveRes, employeesRes] = await Promise.all([
			supabase
				.from("leave_requests")
				.select("id,employee_id,employee_name,leave_type,start_date,end_date,reason,status,manager_feedback,created_at")
				.eq("company_id", activeCompanyId)
				.order("created_at", { ascending: false })
				.limit(400),
			supabase
				.from("employees")
				.select("id,first_name,last_name")
				.eq("company_id", activeCompanyId)
				.order("first_name", { ascending: true }),
		]);

		setLeaveRequests((leaveRes.data || []) as LeaveRequestRow[]);
		setEmployees((employeesRes.data || []) as EmployeeRow[]);
		setLoading(false);
	}

	return (
		<main className="min-h-screen bg-[#04100d] px-6 py-8">
			{loading ? (
				<div className="rounded-3xl bg-white p-6 text-sm font-bold text-slate-600">Loading leave command centre...</div>
			) : (
				<>
					<LeaveControlCentrePanel leaveRequests={leaveRequests} employees={employees} onUpdated={() => loadData(companyId)} />
					  <LeaveApprovalsPanel companyId={companyId} onUpdated={() => loadData(companyId)} />
					<LeaveBalancePanel companyId={companyId} onUpdated={() => loadData(companyId)} />
					<LeaveDecisionAuditPanel />
					<LeaveManagementExcellencePanel />
				</>
			)}
		</main>
	);
}
