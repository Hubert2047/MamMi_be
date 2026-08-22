import mongoose, { Schema, Document } from 'mongoose'

type CashData = {
    [denomination: number]: number
}

export interface IDailyClosing extends Document {
    periodStart: Date
    periodEnd: Date
    status: 'confirmed' | 'voided'
    actualTotal: number
    systemAmount: number
    cash: CashData
    reason: string
    previousClosingAmount: number
    cashSales: number
    otherRevenueTotal: number
    expensesTotal: number
    difference: number
    confirmedAt: Date
    confirmedBy?: string
    voidedAt?: Date
    voidedBy?: string
    voidReason?: string
    createdAt: Date
    updatedAt: Date
}

const DailyClosingSchema = new Schema<IDailyClosing>(
    {
        periodStart: { type: Date, required: true },
        periodEnd: { type: Date, required: true },
        status: { type: String, enum: ['confirmed', 'voided'], default: 'confirmed', required: true },
        actualTotal: { type: Number, required: true },
        systemAmount: { type: Number, required: true },
        reason: String,
        previousClosingAmount: { type: Number, required: true },
        cashSales: { type: Number, required: true },
        otherRevenueTotal: { type: Number, required: true },
        expensesTotal: { type: Number, required: true },
        difference: { type: Number, required: true },
        confirmedAt: { type: Date, required: true },
        confirmedBy: String,
        voidedAt: Date,
        voidedBy: String,
        voidReason: String,
        cash: {
            type: Map,
            of: Number,
            default: {},
        },
    },
    { timestamps: true },
)

DailyClosingSchema.index({ createdAt: 1 })
DailyClosingSchema.index({ status: 1, periodEnd: -1 })
DailyClosingSchema.index({ status: 1, periodStart: 1, periodEnd: 1 })

export default mongoose.model<IDailyClosing>('DailyClosing', DailyClosingSchema)
