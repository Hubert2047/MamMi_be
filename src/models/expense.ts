import mongoose, { Schema, Document } from "mongoose";

export interface IExpense extends Document {
  name: string;       
  price: number;    
  note?: string;    
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  note: String
}, { timestamps: true });

ExpenseSchema.index({ createdAt: 1 });

export default mongoose.model<IExpense>("Expense", ExpenseSchema);
