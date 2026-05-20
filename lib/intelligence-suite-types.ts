/** Client-safe Stage 2 intelligence result shapes (no engine implementation). */

export interface LeakageEngineResult {
  totalLeakageZAR: number;
  leakageByBranch: Record<string, number>;
  leakageByManager: Array<{ managerKey: string; leakageZAR: number }>;
}

export interface BuddyAlert {
  incidentId: string;
  employeeA: string;
  employeeB: string;
  anchorTime: string;
  reason: "device" | "ip" | "gps";
}

export interface BuddyClockingGuardResult {
  buddyClockingSuspicionScore: number;
  activeBuddyAlerts: BuddyAlert[];
  repeatOffenders: Array<{ employeeId: string; incidentCount: number }>;
}

export interface OverstaffedShift {
  rosterShiftId: string;
  storeId: string | null;
  shiftDate: string;
  rosterHeadcount: number;
  uniqueClockIns: number;
  overrunPct: number;
  wastedHoursEstimate: number;
  wastedLaborZAR: number;
}

export interface OptimizationEngineResult {
  optimizationIndex: number;
  overstaffedShifts: OverstaffedShift[];
  laborSavingsOpportunitiesZAR: number;
}

export interface BurnoutAlert {
  employeeId: string;
  name: string;
  department: string;
  riskFactor: string;
}

export interface BurnoutPredictorResult {
  globalBurnoutIndex: number;
  highRiskEmployeeAlerts: BurnoutAlert[];
}

export interface WorkforceIntelligenceState {
  companyId: string;
  leakage: LeakageEngineResult;
  buddyClocking: BuddyClockingGuardResult;
  optimization: OptimizationEngineResult;
  burnout: BurnoutPredictorResult;
  computedAtIso: string;
}

export function emptyWorkforceIntelligenceState(companyId: string): WorkforceIntelligenceState {
  return {
    companyId: companyId || "—",
    leakage: { totalLeakageZAR: 0, leakageByBranch: {}, leakageByManager: [] },
    buddyClocking: {
      buddyClockingSuspicionScore: 0,
      activeBuddyAlerts: [],
      repeatOffenders: [],
    },
    optimization: {
      optimizationIndex: 100,
      overstaffedShifts: [],
      laborSavingsOpportunitiesZAR: 0,
    },
    burnout: { globalBurnoutIndex: 0, highRiskEmployeeAlerts: [] },
    computedAtIso: "",
  };
}
