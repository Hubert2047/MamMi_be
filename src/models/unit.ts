import mongoose, { Schema, type Document } from "mongoose";

export type UnitCategory = "weight" | "volume" | "count";

export interface IUnit extends Document {
  code: string;
  names: { vi: string; en: string; "zh-TW": string };
  category: UnitCategory;
  active: boolean;
}

const UnitSchema = new Schema<IUnit>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    names: {
      vi: { type: String, required: true },
      en: { type: String, required: true },
      "zh-TW": { type: String, required: true },
    },
    category: {
      type: String,
      enum: ["weight", "volume", "count"],
      required: true,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export default mongoose.model<IUnit>("Unit", UnitSchema);
