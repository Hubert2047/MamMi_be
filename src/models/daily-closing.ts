import mongoose, { Schema, Document } from 'mongoose'

type CashData = {
    [denomination: number]: number
}

export interface IDailyClosing extends Document {
    actualTotal: number
    systemAmount: number
    cash: CashData
    reason: string
    closingDay?: string
}

const DailyClosingSchema = new Schema<IDailyClosing>(
    {
        actualTotal: { type: Number, required: true },
        systemAmount: { type: Number, required: true },
        reason: String,
        closingDay: { type: String },
        cash: {
            type: Map,
            of: Number,
            default: {},
        },
    },
    { timestamps: true },
)

DailyClosingSchema.index({ createdAt: 1 })
DailyClosingSchema.index({ closingDay: 1 }, { unique: true, sparse: true })

export default mongoose.model<IDailyClosing>('DailyClosing', DailyClosingSchema)
