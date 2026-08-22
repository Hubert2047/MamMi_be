import mongoose, { Schema, Document } from "mongoose";

export interface IExpense extends Document {
  storeId: mongoose.Types.ObjectId;
  name: string;       
  price: number;    
  note?: string;    
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>({
  storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  note: String
}, { timestamps: true });

ExpenseSchema.index({ storeId: 1, createdAt: 1 });

export default mongoose.model<IExpense>("Expense", ExpenseSchema);
