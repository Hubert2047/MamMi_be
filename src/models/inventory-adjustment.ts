import mongoose, { Schema, type Document } from 'mongoose'

export interface IInventoryAdjustment extends Document {
    storeId: mongoose.Types.ObjectId
    inventoryItemId: mongoose.Types.ObjectId
    stockQuantity: number
    reason: string
    stocktakeId?: mongoose.Types.ObjectId
}

const InventoryAdjustmentSchema = new Schema<IInventoryAdjustment>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    stockQuantity: { type: Number, required: true },
    reason: { type: String, required: true },
    stocktakeId: { type: Schema.Types.ObjectId, ref: 'InventoryStocktake' },
}, { timestamps: true })

InventoryAdjustmentSchema.index({ storeId: 1, inventoryItemId: 1, createdAt: -1 })

export default mongoose.model<IInventoryAdjustment>('InventoryAdjustment', InventoryAdjustmentSchema)
