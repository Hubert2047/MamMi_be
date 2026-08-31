import mongoose, { Schema, Document } from "mongoose";

export interface IExpense extends Document {
  storeId: mongoose.Types.ObjectId;
  name: string;       
  quantity: number;
  unit?: string;
  unitPrice: number;
  price: number;    
  note?: string;    
  type: 'other' | 'inventory_purchase';
  receiptId?: mongoose.Types.ObjectId;
  category?: string;
  paymentMethod: 'cash' | 'bank_transfer' | 'other';
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSchema = new Schema<IExpense>({
  storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, default: 1, min: 0.001 },
  unit: { type: String, default: '' },
  unitPrice: { type: Number, required: true, default: 0, min: 0 },
  price: { type: Number, required: true },
  note: String,
  type: { type: String, enum: ['other', 'inventory_purchase'], default: 'other' },
  receiptId: { type: Schema.Types.ObjectId, ref: 'InventoryReceipt' },
  category: { type: String, default: 'other' },
  paymentMethod: { type: String, enum: ['cash', 'bank_transfer', 'other'], default: 'cash' },
}, { timestamps: true });

ExpenseSchema.index({ storeId: 1, createdAt: 1 });

export default mongoose.model<IExpense>("Expense", ExpenseSchema);
