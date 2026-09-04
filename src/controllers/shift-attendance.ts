import type { Request, Response } from "express";
import ShiftAttendance from "../models/shift-attendance.js";
import Employee from "../models/employee.js";
import { toZonedTime, format } from "date-fns-tz";
import { TIME_ZONE } from "../utils/index.js";
import { type AuthRequest } from "../middlewares/auth.js";
import { Role } from "../constants/role.js";
import { completedHours as calculateCompletedHours } from "../utils/shiftAttendanceCalculations.js";
import { isValidSessionRange } from "../utils/shiftAttendanceCalculations.js";

type Session = { checkIn: Date; checkOut?: Date };

const taiwanDate = (value = new Date()) =>
  format(toZonedTime(value, TIME_ZONE), "yyyy-MM-dd", { timeZone: TIME_ZONE });

const legacySessions = (attendance: any): Session[] => {
  if (attendance.sessions?.length) return attendance.sessions;
  if (!attendance.checkIn) return [];
  const lastCheckOut = attendance.checkOuts?.at(-1);
  return [
    {
      checkIn: attendance.checkIn,
      ...(lastCheckOut ? { checkOut: lastCheckOut } : {}),
    },
  ];
};

const sessionsOf = (attendance: any): Session[] =>
  attendance.checkInAt
    ? [
        {
          checkIn: attendance.checkInAt,
          ...(attendance.checkOutAt ? { checkOut: attendance.checkOutAt } : {}),
        },
      ]
    : legacySessions(attendance);

const openSessionQuery = (employeeId: unknown): any => ({
  employeeId,
  $or: [
    { checkInAt: { $exists: true }, checkOutAt: { $exists: false } },
    {
      sessions: {
        $elemMatch: {
          checkIn: { $exists: true },
          checkOut: { $exists: false },
        },
      },
    },
    { checkIn: { $exists: true }, checkOuts: { $size: 0 } },
  ],
});

const serializeAttendance = (
  attendance: any,
  employeeMap: Map<string, string>,
) => {
  const sessions = sessionsOf(attendance);
  const workDate =
    attendance.workDate || attendance.date || taiwanDate(sessions[0]?.checkIn);
  const workingHours =
    attendance.workingHours ?? calculateCompletedHours(sessions);
  return {
    ...attendance,
    date: workDate,
    workDate,
    sessions,
    workingHours: Number(workingHours.toFixed(2)),
    employeeName:
      employeeMap.get(String(attendance.employeeId)) || attendance.numberId,
  };
};

export const getAttendances = async (req: Request, res: Response) => {
  try {
    const storeId = (req as AuthRequest).user.storeId;
    const startTime =
      typeof req.query.startTime === "string"
        ? new Date(req.query.startTime)
        : undefined;
    const endTime =
      typeof req.query.endTime === "string"
        ? new Date(req.query.endTime)
        : undefined;
    if (
      (startTime && Number.isNaN(startTime.getTime())) ||
      (endTime && Number.isNaN(endTime.getTime())) ||
      (startTime && endTime && startTime > endTime)
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid attendance time range" });

    const employees = await Employee.find({ storeId })
      .select({ _id: 1, name: 1 })
      .lean();
    const employeeIds = employees.map((employee) => employee._id);
    const employeeMap = new Map(
      employees.map((employee) => [String(employee._id), employee.name]),
    );
    const date =
      typeof req.query.date === "string" && req.query.date
        ? req.query.date
        : taiwanDate();
    const conditions: any[] = [];
    if (startTime || endTime) {
      const from = startTime || new Date(0);
      const to = endTime || new Date();
      conditions.push(
        {
          checkInAt: { $lte: to },
          $or: [
            { checkOutAt: { $gte: from } },
            { checkOutAt: { $exists: false } },
          ],
        },
        { date: { $gte: taiwanDate(from), $lte: taiwanDate(to) } },
      );
    } else {
      conditions.push(
        { workDate: date },
        { date },
        { checkInAt: { $lte: new Date() }, checkOutAt: { $exists: false } },
      );
    }
    const attendances = await ShiftAttendance.find({
      employeeId: { $in: employeeIds },
      $or: conditions,
    } as any)
      .sort({ workDate: -1, date: -1, checkInAt: -1, checkIn: -1 })
      .lean();
    const filtered =
      startTime || endTime
        ? attendances.filter((attendance: any) =>
            sessionsOf(attendance).some((session) => {
              const checkIn = new Date(session.checkIn).getTime();
              const checkOut = session.checkOut
                ? new Date(session.checkOut).getTime()
                : Number.POSITIVE_INFINITY;
              return (
                (!endTime || checkIn <= endTime.getTime()) &&
                (!startTime || checkOut >= startTime.getTime())
              );
            }),
          )
        : attendances;
    return res.json({
      success: true,
      data: filtered.map((attendance) =>
        serializeAttendance(attendance, employeeMap),
      ),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Error fetching attendance", error });
  }
};

export const updateAttendance = async (req: Request, res: Response) => {
  try {
    const user = (req as AuthRequest).user;
    if (user.role !== Role.SuperAdmin)
      return res
        .status(403)
        .json({
          success: false,
          message: "Only SuperAdmin can edit attendance",
        });

    const {
      checkInAt: rawCheckInAt,
      checkOutAt: rawCheckOutAt,
      reason,
    } = req.body;
    if (typeof reason !== "string" || !reason.trim())
      return res
        .status(400)
        .json({ success: false, message: "Adjustment reason is required" });
    const checkInAt = new Date(rawCheckInAt);
    const checkOutAt = rawCheckOutAt ? new Date(rawCheckOutAt) : undefined;
    if (
      Number.isNaN(checkInAt.getTime()) ||
      (checkOutAt && Number.isNaN(checkOutAt.getTime()))
    )
      return res
        .status(400)
        .json({ success: false, message: "Invalid attendance time" });
    if (!isValidSessionRange(checkInAt, checkOutAt))
      return res
        .status(400)
        .json({ success: false, message: "Check-out must be after check-in" });

    const attendance = await ShiftAttendance.findById(req.params.id);
    if (!attendance || !attendance.checkInAt)
      return res
        .status(404)
        .json({ success: false, message: "Attendance session not found" });
    const employee = await Employee.findOne({
      _id: attendance.employeeId,
      storeId: user.storeId,
    })
      .select({ _id: 1 })
      .lean();
    if (!employee)
      return res
        .status(404)
        .json({ success: false, message: "Attendance session not found" });

    const others = await ShiftAttendance.find({
      employeeId: attendance.employeeId,
      _id: { $ne: attendance._id },
    }).lean();
    const newEnd = checkOutAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const overlaps = others.some((other: any) =>
      sessionsOf(other).some((session) => {
        const start = new Date(session.checkIn).getTime();
        const end = session.checkOut
          ? new Date(session.checkOut).getTime()
          : Number.POSITIVE_INFINITY;
        return checkInAt.getTime() < end && start < newEnd;
      }),
    );
    if (overlaps)
      return res
        .status(409)
        .json({
          success: false,
          message: "Attendance session overlaps another session",
        });

    if (!attendance.originalCheckInAt)
      attendance.originalCheckInAt = attendance.checkInAt;
    if (attendance.checkOutAt && !attendance.originalCheckOutAt)
      attendance.originalCheckOutAt = attendance.checkOutAt;
    attendance.checkInAt = checkInAt;
    attendance.workDate = taiwanDate(checkInAt);
    if (checkOutAt) {
      attendance.checkOutAt = checkOutAt;
      attendance.workingHours = parseFloat(
        (
          (checkOutAt.getTime() - checkInAt.getTime()) /
          (1000 * 60 * 60)
        ).toFixed(2),
      );
    } else {
      delete (attendance as any).checkOutAt;
      delete (attendance as any).workingHours;
    }
    attendance.status = checkOutAt ? "done" : "working";
    attendance.adjusted = true;
    attendance.adjustmentReason = reason.trim();
    attendance.adjustedBy = user.account;
    attendance.adjustedAt = new Date();
    await attendance.save();
    return res.json({
      success: true,
      data: serializeAttendance(attendance, new Map()),
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Error updating attendance", error });
  }
};

export const checkIn = async (req: Request, res: Response) => {
  try {
    const { numberId } = req.body;
    if (!numberId)
      return res
        .status(400)
        .json({ success: false, message: "numberId is required" });
    const employee = await Employee.findOne({
      numberId,
      storeId: (req as AuthRequest).user.storeId,
    });
    if (!employee)
      return res
        .status(400)
        .json({ success: false, message: "Employee not found" });
    if (employee.active === false)
      return res
        .status(403)
        .json({ success: false, message: "Employee is inactive" });
    if (await ShiftAttendance.findOne(openSessionQuery(employee._id)))
      return res
        .status(400)
        .json({ success: false, message: "Already checked in today" });

    const checkInAt = new Date();
    const attendance = new ShiftAttendance({
      employeeId: employee._id,
      numberId,
      checkInAt,
      workDate: taiwanDate(checkInAt),
      status: "working",
    });
    await attendance.save();
    return res.json({
      success: true,
      message: "Checked in successfully",
      data: attendance,
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error });
  }
};

export const checkOut = async (req: Request, res: Response) => {
  try {
    const { numberId } = req.body;
    if (!numberId)
      return res
        .status(400)
        .json({ success: false, message: "numberId is required" });
    const employee = await Employee.findOne({
      numberId,
      storeId: (req as AuthRequest).user.storeId,
    });
    if (!employee)
      return res
        .status(400)
        .json({ success: false, message: "Employee not found" });
    const attendance = await ShiftAttendance.findOne(
      openSessionQuery(employee._id),
    ).sort({ checkInAt: -1, checkIn: -1 });
    if (!attendance)
      return res
        .status(400)
        .json({ success: false, message: "No check-in found for today" });

    if (attendance.checkInAt && !attendance.checkOutAt) {
      attendance.checkOutAt = new Date();
      attendance.workingHours = parseFloat(
        (
          (attendance.checkOutAt.getTime() - attendance.checkInAt.getTime()) /
          (1000 * 60 * 60)
        ).toFixed(2),
      );
      attendance.status = "done";
    } else {
      const sessions = legacySessions(attendance);
      const openSession = sessions.find((session) => !session.checkOut);
      if (!openSession)
        return res
          .status(400)
          .json({ success: false, message: "No check-in found for today" });
      openSession.checkOut = new Date();
      attendance.sessions = sessions;
      attendance.workingHours = parseFloat(
        calculateCompletedHours(sessions).toFixed(2),
      );
      attendance.status = sessions.some((session) => !session.checkOut)
        ? "working"
        : "done";
    }
    await attendance.save();
    return res.json({
      success: true,
      message: "Checked out successfully",
      data: serializeAttendance(attendance, new Map()),
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error });
  }
};
