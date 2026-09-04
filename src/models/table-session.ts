import mongoose, { Schema, type Document } from "mongoose";

export type TableSessionStatus = "active" | "closed" | "expired";

export interface ITableSession extends Document {
  storeId: mongoose.Types.ObjectId;
  tableId: mongoose.Types.ObjectId;
  status: TableSessionStatus;
  openedAt: Date;
  expiresAt: Date;
  lastExtendedAt?: Date;
  closedAt?: Date;
  qrOrderWindowStartedAt?: Date;
  qrOrderWindowCount: number;
}

const TableSessionSchema = new Schema<ITableSession>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    tableId: { type: Schema.Types.ObjectId, ref: "StoreTable", required: true },
    status: {
      type: String,
      enum: ["active", "closed", "expired"],
      default: "active",
      required: true,
    },
    openedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },
    lastExtendedAt: Date,
    closedAt: Date,
    qrOrderWindowStartedAt: Date,
    qrOrderWindowCount: { type: Number, default: 0, required: true },
  },
  { timestamps: true },
);

TableSessionSchema.index(
  { storeId: 1, tableId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);
TableSessionSchema.index({ storeId: 1, tableId: 1, openedAt: -1 });
TableSessionSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model<ITableSession>(
  "TableSession",
  TableSessionSchema,
);
