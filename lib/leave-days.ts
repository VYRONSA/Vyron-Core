/**
 * Leave days shown on screen: working days (Monday–Friday by default) between two dates,
 * inclusive. The database is authoritative — leave_requests.requested_days is set by
 * vyron_leave_working_days() (sql/106), which also excludes the company's public holidays and
 * respects a 6-day working week. Weekends were previously counted as leave.
 */
export function countLeaveWorkingDays(startDate: string, endDate: string, daysPerWeek = 5): number {
  if (!startDate || !endDate) return 0;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  let count = 0;
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    const isoDay = day.getUTCDay() === 0 ? 7 : day.getUTCDay(); // Monday = 1 … Sunday = 7
    if (isoDay <= daysPerWeek) count += 1;
  }
  return count;
}
