import mongoose, { Schema, type Document } from "mongoose";

export interface IPosDevice extends Document {
  storeId: mongoose.Types.ObjectId;
  name: string;
  role: "Employee";
  active: boolean;
  deviceTokenHash?: string | undefined;
  pendingEnrollmentHash?: string | undefined;
  pendingEnrollmentExpiresAt?: Date | undefined;
  enrolledAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  revokedAt?: Date | undefined;
}

const PosDeviceSchema = new Schema<IPosDevice>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ["Employee"],
      default: "Employee",
      required: true,
    },
    active: { type: Boolean, default: true },
    deviceTokenHash: { type: String, unique: true, sparse: true },
    pendingEnrollmentHash: { type: String, unique: true, sparse: true },
    pendingEnrollmentExpiresAt: Date,
    enrolledAt: Date,
    lastSeenAt: Date,
    revokedAt: Date,
  },
  { timestamps: true },
);

PosDeviceSchema.index({ storeId: 1, name: 1 }, { unique: true });

export default mongoose.model<IPosDevice>("PosDevice", PosDeviceSchema);
