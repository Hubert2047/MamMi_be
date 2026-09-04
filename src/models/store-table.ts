import { randomBytes } from "node:crypto";
import mongoose, { Schema, type Document } from "mongoose";

export interface IStoreTable extends Document {
  storeId: mongoose.Types.ObjectId;
  code: string;
  name: string;
  active: boolean;
  qrToken: string;
}

const createQrToken = () => randomBytes(24).toString("base64url");

const StoreTableSchema = new Schema<IStoreTable>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    qrToken: {
      type: String,
      required: true,
      unique: true,
      default: createQrToken,
    },
  },
  { timestamps: true },
);

StoreTableSchema.index({ storeId: 1, code: 1 }, { unique: true });

export default mongoose.model<IStoreTable>("StoreTable", StoreTableSchema);
