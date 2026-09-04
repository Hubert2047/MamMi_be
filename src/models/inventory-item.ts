import mongoose, { Schema, type Document } from "mongoose";

export interface IPurchaseUnit {
  unitCode: string;
  conversionFactor: number;
}

export interface IInventoryItem extends Document {
  storeId: mongoose.Types.ObjectId;
  name: string;
  stockUnitCode: string;
  purchaseUnits: IPurchaseUnit[];
  currentQuantity: number;
  lastStocktakeAt?: Date;
  minimumStock: number;
  active: boolean;
  note?: string;
  inventoryStatus: "pending" | "active";
}

const InventoryItemSchema = new Schema<IInventoryItem>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    stockUnitCode: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    purchaseUnits: [
      {
        unitCode: { type: String, required: true },
        conversionFactor: { type: Number, required: true, min: 0.000001 },
      },
    ],
    currentQuantity: { type: Number, default: 0, min: 0 },
    lastStocktakeAt: Date,
    minimumStock: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
    note: String,
    inventoryStatus: {
      type: String,
      enum: ["pending", "active"],
      default: "active",
      required: true,
    },
  },
  { timestamps: true },
);

InventoryItemSchema.index({ storeId: 1, name: 1 }, { unique: true });

export default mongoose.model<IInventoryItem>(
  "InventoryItem",
  InventoryItemSchema,
);
