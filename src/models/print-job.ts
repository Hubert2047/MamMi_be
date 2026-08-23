import mongoose, { Document, Schema } from 'mongoose'

export type PrintJobStatus = 'queued' | 'processing' | 'printed' | 'failed'
export type PrintJobKind = 'kitchen_item' | 'customer_receipt'

export interface IPrintJob extends Document {
    storeId: mongoose.Types.ObjectId
    orderId: mongoose.Types.ObjectId
    kind: PrintJobKind
    status: PrintJobStatus
    payload: { printableText: string }
    attempts: number
    agentId?: string
    lockedAt?: Date
    printedAt?: Date
    lastError?: string
}

const PrintJobSchema = new Schema<IPrintJob>(
    {
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
        orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
        kind: { type: String, enum: ['kitchen_item', 'customer_receipt'], required: true },
        status: { type: String, enum: ['queued', 'processing', 'printed', 'failed'], default: 'queued', required: true },
        payload: { type: Schema.Types.Mixed, required: true },
        attempts: { type: Number, default: 0, required: true },
        agentId: String,
        lockedAt: Date,
        printedAt: Date,
        lastError: String,
    },
    { timestamps: true },
)

PrintJobSchema.index({ storeId: 1, status: 1, createdAt: 1 })
PrintJobSchema.index({ storeId: 1, orderId: 1, kind: 1 })

export default mongoose.model<IPrintJob>('PrintJob', PrintJobSchema)
