import mongoose, { Schema, type Document } from "mongoose";

export interface IIngredientSupplier extends Document {
  storeId: mongoose.Types.ObjectId;
  inventoryItemId: mongoose.Types.ObjectId;
  supplierId: mongoose.Types.ObjectId;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const IngredientSupplierSchema = new Schema<IIngredientSupplier>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    inventoryItemId: {
      type: Schema.Types.ObjectId,
      ref: "InventoryItem",
      required: true,
      index: true,
    },
    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
      required: true,
      index: true,
    },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

IngredientSupplierSchema.index(
  { inventoryItemId: 1, supplierId: 1 },
  { unique: true },
);
IngredientSupplierSchema.index({
  storeId: 1,
  inventoryItemId: 1,
  isDefault: 1,
});

export default mongoose.model<IIngredientSupplier>(
  "IngredientSupplier",
  IngredientSupplierSchema,
);
