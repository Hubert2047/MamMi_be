import mongoose, { Document, Schema } from 'mongoose'

export type PrintJobStatus = 'queued' | 'processing' | 'printed' | 'failed'
export type PrintJobKind = 'kitchen_item' | 'customer_receipt' | 'test'

export interface IPrintJob extends Document {
    storeId: mongoose.Types.ObjectId
    printerId?: mongoose.Types.ObjectId
    orderId?: mongoose.Types.ObjectId
    kind: PrintJobKind
    status: PrintJobStatus
    payload: { printableText: string }
    attempts: number
    agentId?: string
    lockedAt?: Date
    printedAt?: Date
    retentionUntil?: Date
    lastError?: string
}

const PrintJobSchema = new Schema<IPrintJob>(
    {
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
        printerId: { type: Schema.Types.ObjectId, ref: 'Printer' },
        orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
        kind: { type: String, enum: ['kitchen_item', 'customer_receipt', 'test'], required: true },
        status: { type: String, enum: ['queued', 'processing', 'printed', 'failed'], default: 'queued', required: true },
        payload: { type: Schema.Types.Mixed, required: true },
        attempts: { type: Number, default: 0, required: true },
        agentId: String,
        lockedAt: Date,
        printedAt: Date,
        retentionUntil: Date,
        lastError: String,
    },
    { timestamps: true },
)

PrintJobSchema.index({ storeId: 1, status: 1, createdAt: 1 })
PrintJobSchema.index({ storeId: 1, orderId: 1, kind: 1 })
PrintJobSchema.index({ retentionUntil: 1 }, { expireAfterSeconds: 0 })

export default mongoose.model<IPrintJob>('PrintJob', PrintJobSchema)
