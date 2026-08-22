import mongoose, { Schema, Document } from 'mongoose'

export interface Addon extends Document {
    names: { vi: string; en: string; 'zh-TW': string }
    /** Legacy field kept so existing documents can be read and migrated on update. */
    name?: string
}

const AddonSchema = new Schema<Addon>(
    {
        names: {
            vi: { type: String, default: '', trim: true },
            en: { type: String, default: '', trim: true },
            'zh-TW': { type: String, default: '', trim: true },
        },
        name: { type: String, trim: true },
    },
    { timestamps: true },
)

export default mongoose.model<Addon>('Addon', AddonSchema)
