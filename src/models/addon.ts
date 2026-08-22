import mongoose, { Schema, Document } from 'mongoose'

export interface Addon extends Document {
    names: { vi: string; en: string; 'zh-TW': string }
    /** Legacy field kept so existing documents can be read and migrated on update. */
    name?: string
    priceExtra: number
    active: boolean
}

const AddonSchema = new Schema<Addon>(
    {
        names: {
            vi: { type: String, default: '', trim: true },
            en: { type: String, default: '', trim: true },
            'zh-TW': { type: String, default: '', trim: true },
        },
        name: { type: String, trim: true },
        priceExtra: { type: Number, required: true },
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
)

export default mongoose.model<Addon>('Addon', AddonSchema)
