import mongoose, { Schema, Document } from "mongoose";

export interface IRevenue extends Document {
  name: string;       
  price: number;    
  note?: string;    
}

const RevenueSchema = new Schema<IRevenue>({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  note: String
}, { timestamps: true });

RevenueSchema.index({ createdAt: 1 });

export default mongoose.model<IRevenue>("Revenue", RevenueSchema);
