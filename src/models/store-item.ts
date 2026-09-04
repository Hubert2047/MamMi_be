import mongoose, { Schema, type Document } from "mongoose";

export interface IStoreItem extends Document {
  storeId: mongoose.Types.ObjectId;
  itemId: mongoose.Types.ObjectId;
  price: Map<string, number>;
  visibility: { pos: boolean; qr: boolean; online: boolean };
  addonDisplayMode: "named" | "merged";
  permanentlyActive: boolean;
  temporarilyUnavailable: boolean;
  temporarilyUnavailableUntil?: Date | null;
}

const StoreItemSchema = new Schema<IStoreItem>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    price: {
      type: Map,
      of: {
        type: Number,
        min: 0,
        validate: {
          validator: Number.isSafeInteger,
          message: "Price must be a non-negative integer",
        },
      },
      required: true,
      default: {},
    },
    visibility: {
      pos: { type: Boolean, default: true },
      qr: { type: Boolean, default: true },
      online: { type: Boolean, default: true },
    },
    addonDisplayMode: {
      type: String,
      enum: ["named", "merged"],
      default: "named",
    },
    permanentlyActive: { type: Boolean, default: true },
    temporarilyUnavailable: { type: Boolean, default: false },
    temporarilyUnavailableUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

StoreItemSchema.index({ storeId: 1, itemId: 1 }, { unique: true });
StoreItemSchema.index({
  storeId: 1,
  permanentlyActive: 1,
  temporarilyUnavailable: 1,
});
StoreItemSchema.index({
  storeId: 1,
  temporarilyUnavailable: 1,
  temporarilyUnavailableUntil: 1,
});

export default mongoose.model<IStoreItem>("StoreItem", StoreItemSchema);
