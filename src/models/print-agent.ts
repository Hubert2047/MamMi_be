import mongoose, { Schema, type Document } from "mongoose";

export interface IPrintAgent extends Document {
  storeId: mongoose.Types.ObjectId;
  name: string;
  agentId: string;
  tokenHash: string;
  tokenPrefix: string;
  active: boolean;
  lastSeenAt?: Date;
}
const PrintAgentSchema = new Schema<IPrintAgent>(
  {
    storeId: {
      type: Schema.Types.ObjectId,
      ref: "Store",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    agentId: { type: String, required: true, unique: true, trim: true },
    tokenHash: { type: String, required: true, select: false },
    tokenPrefix: { type: String, required: true },
    active: { type: Boolean, default: true },
    lastSeenAt: Date,
  },
  { timestamps: true },
);
PrintAgentSchema.index({ storeId: 1, active: 1 });
export default mongoose.model<IPrintAgent>("PrintAgent", PrintAgentSchema);
