import mongoose, { Schema, type Document } from 'mongoose'

export interface IStoreItem extends Document {
    storeId: mongoose.Types.ObjectId
    itemId: mongoose.Types.ObjectId
    price: Map<string, number>
    permanentlyActive: boolean
    temporarilyUnavailable: boolean
    temporarilyUnavailableUntil?: Date | null
}

const StoreItemSchema = new Schema<IStoreItem>(
    {
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
        itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
        price: { type: Map, of: Number, required: true, default: {} },
        permanentlyActive: { type: Boolean, default: true },
        temporarilyUnavailable: { type: Boolean, default: false },
        temporarilyUnavailableUntil: { type: Date, default: null },
    },
    { timestamps: true },
)

StoreItemSchema.index({ storeId: 1, itemId: 1 }, { unique: true })
StoreItemSchema.index({ storeId: 1, permanentlyActive: 1, temporarilyUnavailable: 1 })
StoreItemSchema.index({ storeId: 1, temporarilyUnavailable: 1, temporarilyUnavailableUntil: 1 })

export default mongoose.model<IStoreItem>('StoreItem', StoreItemSchema)
