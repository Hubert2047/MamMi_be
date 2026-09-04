import mongoose, { Schema, type Document } from "mongoose";

export interface ILineGroup extends Document {
  lineGroupId: string;
  storeId?: mongoose.Types.ObjectId;
  name: string;
  usageStatus: "available" | "assigned";
  createdAt: Date;
  updatedAt: Date;
}

const LineGroupSchema = new Schema<ILineGroup>(
  {
    lineGroupId: { type: String, required: true, unique: true, trim: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store" },
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      default: "LINE group",
    },
    usageStatus: {
      type: String,
      enum: ["available", "assigned"],
      default: "available",
      index: true,
    },
  },
  { timestamps: true },
);

LineGroupSchema.index({ storeId: 1, usageStatus: 1 });

export default mongoose.model<ILineGroup>("LineGroup", LineGroupSchema);
