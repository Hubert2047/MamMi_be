import mongoose, { Schema, Document } from 'mongoose'

export interface IDiscount extends Document {
    names: { vi: string; en: string; 'zh-TW': string }
    name?: string
    type: 'percent' | 'value'
    note?: string
}

const DiscountSchema = new Schema<IDiscount>(
    {
        names: {
            vi: { type: String, default: '' },
            en: { type: String, default: '' },
            'zh-TW': { type: String, default: '' },
        },
        name: { type: String, trim: true },
        type: {
            type: String,
            enum: ['percent', 'value'],
            default: 'percent',
        },
        note: String,
    },
    { timestamps: true },
)

export default mongoose.model<IDiscount>('Discount', DiscountSchema)
