import mongoose, { Schema, Document } from "mongoose";

export interface IRevenue extends Document {
  storeId: mongoose.Types.ObjectId;
  name: string;
  price: number;
  paymentMethod: "cash" | "bank_transfer" | "other";
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RevenueSchema = new Schema<IRevenue>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["cash", "bank_transfer", "other"],
      default: "cash",
    },
    note: String,
  },
  { timestamps: true },
);

RevenueSchema.index({ storeId: 1, createdAt: 1 });

export default mongoose.model<IRevenue>("Revenue", RevenueSchema);
