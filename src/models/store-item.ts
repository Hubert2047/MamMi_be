import mongoose, { Schema, type Document } from 'mongoose'

export interface IStoreItem extends Document {
    storeId: mongoose.Types.ObjectId
    itemId: mongoose.Types.ObjectId
    price: Map<string, number>
    active: boolean
}

const StoreItemSchema = new Schema<IStoreItem>(
    {
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
        itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true },
        price: { type: Map, of: Number, required: true, default: {} },
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
)

StoreItemSchema.index({ storeId: 1, itemId: 1 }, { unique: true })
StoreItemSchema.index({ storeId: 1, active: 1 })

export default mongoose.model<IStoreItem>('StoreItem', StoreItemSchema)
