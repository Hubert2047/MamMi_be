import mongoose, { Schema, type Document } from 'mongoose'

export interface IInventoryReceiptLine {
    inventoryItemId: mongoose.Types.ObjectId
    quantity: number
    unitCode: string
    conversionFactor: number
    stockQuantity: number
    unitPrice: number
    total: number
}

export interface IInventoryReceipt extends Document {
    storeId: mongoose.Types.ObjectId
    supplierName?: string
    receivedAt: Date
    totalAmount: number
    expenseId?: mongoose.Types.ObjectId
    note?: string
    lines: IInventoryReceiptLine[]
}

const ReceiptLineSchema = new Schema<IInventoryReceiptLine>({
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    quantity: { type: Number, required: true, min: 0.000001 },
    unitCode: { type: String, required: true },
    conversionFactor: { type: Number, required: true, min: 0.000001 },
    stockQuantity: { type: Number, required: true, min: 0.000001 },
    unitPrice: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
}, { _id: false })

const InventoryReceiptSchema = new Schema<IInventoryReceipt>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    supplierName: String,
    receivedAt: { type: Date, default: Date.now },
    totalAmount: { type: Number, required: true, min: 0 },
    expenseId: { type: Schema.Types.ObjectId, ref: 'Expense' },
    note: String,
    lines: { type: [ReceiptLineSchema], required: true, validate: (value: unknown[]) => value.length > 0 },
}, { timestamps: true })

InventoryReceiptSchema.index({ storeId: 1, receivedAt: -1 })

export default mongoose.model<IInventoryReceipt>('InventoryReceipt', InventoryReceiptSchema)
