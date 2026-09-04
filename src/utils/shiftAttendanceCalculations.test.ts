import { describe, expect, it } from "vitest";
import {
  completedHours,
  isValidSessionRange,
  sessionMinutes,
} from "./shiftAttendanceCalculations.js";

describe("work session calculations", () => {
  it("calculates a session across midnight", () => {
    const checkIn = new Date("2026-09-02T23:00:00+08:00");
    const checkOut = new Date("2026-09-03T01:00:00+08:00");

    expect(sessionMinutes({ checkIn, checkOut })).toBe(120);
    expect(completedHours([{ checkIn, checkOut }])).toBe(2);
  });

  it("sums multiple completed sessions in one workday", () => {
    expect(
      completedHours([
        {
          checkIn: new Date("2026-09-02T09:00:00+08:00"),
          checkOut: new Date("2026-09-02T12:15:00+08:00"),
        },
        {
          checkIn: new Date("2026-09-02T13:00:00+08:00"),
          checkOut: new Date("2026-09-02T17:30:00+08:00"),
        },
      ]),
    ).toBe(7.75);
  });

  it("uses a supplied current time for an open session", () => {
    expect(
      sessionMinutes(
        { checkIn: new Date("2026-09-02T23:30:00+08:00") },
        new Date("2026-09-03T01:00:00+08:00"),
      ),
    ).toBe(90);
  });

  it("rejects a checkout before check-in", () => {
    expect(
      isValidSessionRange(
        new Date("2026-09-02T12:00:00+08:00"),
        new Date("2026-09-02T11:59:00+08:00"),
      ),
    ).toBe(false);
  });
});
