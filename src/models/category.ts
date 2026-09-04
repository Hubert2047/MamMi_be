import mongoose, { Schema, Document } from "mongoose";

export interface ICategory extends Document {
  names: {
    vi: string;
    en: string;
    "zh-TW": string;
  };
  /** Legacy field kept so existing documents can be read and migrated on update. */
  name?: string;
  sortOrder: number;
}

const CategorySchema = new Schema<ICategory>({
  names: {
    vi: { type: String, default: "", trim: true },
    en: { type: String, default: "", trim: true },
    "zh-TW": { type: String, default: "", trim: true },
  },
  name: { type: String, trim: true },
  sortOrder: { type: Number, default: 0, min: 0 },
});

export default mongoose.model<ICategory>("Category", CategorySchema);
