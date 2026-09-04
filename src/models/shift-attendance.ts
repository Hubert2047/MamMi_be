import mongoose, { Schema, Document } from "mongoose";

export interface IShiftAttendance extends Document {
  employeeId: Schema.Types.ObjectId;
  numberId: string;
  // New records store one document per work session.
  checkInAt?: Date;
  checkOutAt?: Date;
  workDate?: string;
  // Legacy fields are kept so existing attendance records remain readable.
  checkIn?: Date;
  checkOuts?: Date[];
  sessions?: { checkIn: Date; checkOut?: Date }[];
  workingHours?: number;
  status: "working" | "done";
  date?: string;
  adjusted?: boolean;
  originalCheckInAt?: Date;
  originalCheckOutAt?: Date;
  adjustmentReason?: string;
  adjustedBy?: string;
  adjustedAt?: Date;
}

const ShiftAttendanceSchema = new Schema<IShiftAttendance>(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    numberId: { type: String, required: true },
    checkInAt: { type: Date, index: true },
    checkOutAt: { type: Date },
    workDate: { type: String, index: true },
    checkIn: { type: Date },
    checkOuts: { type: [Date], default: undefined },
    sessions: { type: [{ checkIn: Date, checkOut: Date }], default: undefined },
    workingHours: { type: Number },
    status: { type: String, enum: ["working", "done"], default: "working" },
    date: { type: String },
    adjusted: { type: Boolean, default: false },
    originalCheckInAt: { type: Date },
    originalCheckOutAt: { type: Date },
    adjustmentReason: { type: String },
    adjustedBy: { type: String },
    adjustedAt: { type: Date },
  },
  { timestamps: true },
);

ShiftAttendanceSchema.index({ employeeId: 1, checkInAt: -1 });
ShiftAttendanceSchema.index({ employeeId: 1, status: 1 });
ShiftAttendanceSchema.index({ numberId: 1, date: 1 });

export default mongoose.model<IShiftAttendance>(
  "ShiftAttendance",
  ShiftAttendanceSchema,
);
