import mongoose, { Document, Schema } from "mongoose";

export interface IOrderCounter extends Document {
  storeId: mongoose.Types.ObjectId;
  periodId: string;
  sequence: number;
}

const OrderCounterSchema = new Schema<IOrderCounter>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    periodId: { type: String, required: true },
    sequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

OrderCounterSchema.index({ storeId: 1, periodId: 1 }, { unique: true });

export default mongoose.model<IOrderCounter>(
  "OrderCounter",
  OrderCounterSchema,
);
