import mongoose, { Schema, type Document } from 'mongoose'

export interface IStoreAddon extends Document {
    storeId: mongoose.Types.ObjectId
    addonId: mongoose.Types.ObjectId
    priceExtra: number
    active: boolean
}

const StoreAddonSchema = new Schema<IStoreAddon>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    addonId: { type: Schema.Types.ObjectId, ref: 'Addon', required: true },
    priceExtra: { type: Number, required: true, default: 0 },
    active: { type: Boolean, default: true },
}, { timestamps: true })

StoreAddonSchema.index({ storeId: 1, addonId: 1 }, { unique: true })
StoreAddonSchema.index({ storeId: 1, active: 1 })

export default mongoose.model<IStoreAddon>('StoreAddon', StoreAddonSchema)
