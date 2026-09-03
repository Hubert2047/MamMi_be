import mongoose, { Schema, Document } from 'mongoose'

type CashData = {
    [denomination: number]: number
}

export interface IDailyClosing extends Document {
    storeId: mongoose.Types.ObjectId
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
    confirmedByEmployee?: {
        employeeId: mongoose.Types.ObjectId
        numberId: string
        name: string
    }
    voidedAt?: Date
    voidedBy?: string
    voidReason?: string
    createdAt: Date
    updatedAt: Date
}

const DailyClosingSchema = new Schema<IDailyClosing>(
    {
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
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
        confirmedByEmployee: {
            employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
            numberId: { type: String, required: true },
            name: { type: String, required: true },
        },
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

DailyClosingSchema.index({ storeId: 1, createdAt: 1 })
DailyClosingSchema.index({ storeId: 1, status: 1, periodEnd: -1 })
DailyClosingSchema.index({ storeId: 1, status: 1, periodStart: 1, periodEnd: 1 })
DailyClosingSchema.index(
    { storeId: 1, periodStart: 1 },
    { unique: true, partialFilterExpression: { status: 'confirmed' }, name: 'unique_confirmed_closing_period' },
)

export default mongoose.model<IDailyClosing>('DailyClosing', DailyClosingSchema)
