import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ATTENDANCE_RULES,
  assessEmployeeDay,
  computeAttendanceSummary,
  computeAttendanceTrend,
  sastDate,
} from "@/lib/attendance-summary";

/**
 * Manager attendance maths. The audit found the panel counted every unrostered employee
 * as absent, ignored approved leave, used UTC days and built its 14-day trend from today's
 * clockings only. These cases pin the corrected behaviour.
 */

// 2026-11-19 10:00 SAST = 08:00 UTC
const NOW = new Date("2026-11-19T08:00:00Z");
const rules = DEFAULT_ATTENDANCE_RULES;

describe("sastDate", () => {
  it("uses the South African calendar day, not UTC", () => {
    // 23:30 UTC on the 18th is 01:30 SAST on the 19th.
    assert.equal(sastDate("2026-11-18T23:30:00Z"), "2026-11-19");
    assert.equal(sastDate("2026-11-19T21:59:00Z"), "2026-11-19");
  });
});

describe("assessEmployeeDay", () => {
  const shift = {
    employee_id: "e1",
    shift_date: "2026-11-19",
    planned_start: "2026-11-19T08:00:00+02:00",
    planned_end: "2026-11-19T16:00:00+02:00",
    status: "scheduled",
  };

  it("does not mark an unrostered employee absent", () => {
    const result = assessEmployeeDay({ employeeId: "e1", day: "2026-11-19", events: [], shifts: [], leaves: [], now: NOW, rules });
    assert.equal(result.absent, false);
  });

  it("marks a rostered employee with no clocking absent once the shift has started", () => {
    const result = assessEmployeeDay({ employeeId: "e1", day: "2026-11-19", events: [], shifts: [shift], leaves: [], now: NOW, rules });
    assert.equal(result.absent, true);
  });

  it("does not mark absent before the shift starts", () => {
    const early = new Date("2026-11-19T05:00:00Z"); // 07:00 SAST
    const result = assessEmployeeDay({ employeeId: "e1", day: "2026-11-19", events: [], shifts: [shift], leaves: [], now: early, rules });
    assert.equal(result.absent, false);
  });

  it("does not mark an employee on approved leave absent", () => {
    const leave = { employee_id: "e1", start_date: "2026-11-18", end_date: "2026-11-20", status: "approved" };
    const result = assessEmployeeDay({ employeeId: "e1", day: "2026-11-19", events: [], shifts: [shift], leaves: [leave], now: NOW, rules });
    assert.equal(result.absent, false);
    assert.equal(result.onLeave, true);
  });

  it("still marks absent when the leave was only requested, not approved", () => {
    const leave = { employee_id: "e1", start_date: "2026-11-18", end_date: "2026-11-20", status: "pending" };
    const result = assessEmployeeDay({ employeeId: "e1", day: "2026-11-19", events: [], shifts: [shift], leaves: [leave], now: NOW, rules });
    assert.equal(result.absent, true);
  });

  it("applies the late grace period", () => {
    const within = assessEmployeeDay({
      employeeId: "e1", day: "2026-11-19", shifts: [shift], leaves: [], now: NOW, rules,
      events: [{ employee_id: "e1", event_type: "clock_in", event_time: "2026-11-19T08:05:00+02:00", attendance_date: "2026-11-19" }],
    });
    assert.equal(within.late, false);
    const late = assessEmployeeDay({
      employeeId: "e1", day: "2026-11-19", shifts: [shift], leaves: [], now: NOW, rules,
      events: [{ employee_id: "e1", event_type: "clock_in", event_time: "2026-11-19T08:12:00+02:00", attendance_date: "2026-11-19" }],
    });
    assert.equal(late.late, true);
    assert.equal(late.lateMinutes, 12);
  });

  it("keeps an overnight clock-out on the shift's start day", () => {
    const night = {
      employee_id: "e1",
      shift_date: "2026-11-18",
      planned_start: "2026-11-18T22:00:00+02:00",
      planned_end: "2026-11-19T06:00:00+02:00",
      status: "scheduled",
    };
    const events = [
      { employee_id: "e1", event_type: "clock_in", event_time: "2026-11-18T22:00:00+02:00", attendance_date: "2026-11-18" },
      { employee_id: "e1", event_type: "clock_out", event_time: "2026-11-19T05:00:00+02:00", attendance_date: "2026-11-18" },
    ];
    const day = assessEmployeeDay({ employeeId: "e1", day: "2026-11-18", events, shifts: [night], leaves: [], now: NOW, rules });
    assert.equal(day.worked, true);
    assert.equal(day.earlyDeparture, true, "left 60 minutes before the 06:00 end");
    const nextDay = assessEmployeeDay({ employeeId: "e1", day: "2026-11-19", events, shifts: [], leaves: [], now: NOW, rules });
    assert.equal(nextDay.worked, false, "the clock-out does not create a second day of work");
  });
});

describe("computeAttendanceSummary", () => {
  it("counts an overnight open shift as clocked in after midnight and a stale one as a missed clock-out", () => {
    const events = [
      { employee_id: "night", event_type: "clock_in", event_time: "2026-11-18T22:00:00+02:00", attendance_date: "2026-11-18" },
      { employee_id: "stale", event_type: "clock_in", event_time: "2026-11-18T06:00:00+02:00", attendance_date: "2026-11-18" },
    ];
    const summary = computeAttendanceSummary({ employeeIds: ["night", "stale", "idle"], events, shifts: [], leaves: [], now: NOW, rules });
    assert.equal(summary.clockedInNow, 1);
    assert.equal(summary.missingClockOut, 1);
    assert.equal(summary.absentToday, 0, "nobody was rostered today");
  });
});

describe("computeAttendanceTrend", () => {
  it("uses the clockings of each day, not only today's", () => {
    const shifts = ["2026-11-17", "2026-11-18", "2026-11-19"].map((day) => ({
      employee_id: "e1",
      shift_date: day,
      planned_start: `${day}T08:00:00+02:00`,
      planned_end: `${day}T16:00:00+02:00`,
      status: "scheduled",
    }));
    const events = [
      { employee_id: "e1", event_type: "clock_in", event_time: "2026-11-17T08:30:00+02:00", attendance_date: "2026-11-17" },
      { employee_id: "e1", event_type: "clock_in", event_time: "2026-11-19T08:00:00+02:00", attendance_date: "2026-11-19" },
    ];
    const trend = computeAttendanceTrend({ employeeIds: ["e1"], events, shifts, leaves: [], days: 3, now: NOW, rules });
    assert.deepEqual(trend.days, ["2026-11-17", "2026-11-18", "2026-11-19"]);
    assert.deepEqual(trend.late, [1, 0, 0]);
    assert.deepEqual(trend.absent, [0, 1, 0]);
  });
});
