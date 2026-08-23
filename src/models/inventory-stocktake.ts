import mongoose, { Schema, type Document } from 'mongoose'

export interface IInventoryStocktakeLine {
    inventoryItemId: mongoose.Types.ObjectId
    stockUnitCode: string
    systemQuantity: number
    actualQuantity: number
    difference: number
    reason?: string
}

export interface IInventoryStocktake extends Document {
    storeId: mongoose.Types.ObjectId
    checkedAt: Date
    lines: IInventoryStocktakeLine[]
}

const LineSchema = new Schema<IInventoryStocktakeLine>({
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    stockUnitCode: { type: String, required: true },
    systemQuantity: { type: Number, required: true },
    actualQuantity: { type: Number, required: true, min: 0 },
    difference: { type: Number, required: true },
    reason: String,
}, { _id: false })

const InventoryStocktakeSchema = new Schema<IInventoryStocktake>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    checkedAt: { type: Date, default: Date.now },
    lines: { type: [LineSchema], required: true, validate: (value: unknown[]) => value.length > 0 },
}, { timestamps: true })

export default mongoose.model<IInventoryStocktake>('InventoryStocktake', InventoryStocktakeSchema)
