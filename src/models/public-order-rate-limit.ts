import mongoose, { Document, Schema } from "mongoose";

export interface IPublicOrderRateLimit extends Document {
  storeId: mongoose.Types.ObjectId;
  phoneHash: string;
  windowStartedAt: Date;
  count: number;
  expiresAt: Date;
}

const PublicOrderRateLimitSchema = new Schema<IPublicOrderRateLimit>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    phoneHash: { type: String, required: true },
    windowStartedAt: { type: Date, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

PublicOrderRateLimitSchema.index(
  { storeId: 1, phoneHash: 1, windowStartedAt: 1 },
  { unique: true },
);
PublicOrderRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IPublicOrderRateLimit>(
  "PublicOrderRateLimit",
  PublicOrderRateLimitSchema,
);
