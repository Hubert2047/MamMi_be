import mongoose, { Schema, type Document } from 'mongoose'

export interface IStoreAddon extends Document {
    storeId: mongoose.Types.ObjectId
    addonId: mongoose.Types.ObjectId
    priceExtra: number
    permanentlyActive: boolean
    temporarilyUnavailable: boolean
    temporarilyUnavailableUntil?: Date | null
}

const StoreAddonSchema = new Schema<IStoreAddon>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    addonId: { type: Schema.Types.ObjectId, ref: 'Addon', required: true },
    priceExtra: { type: Number, required: true, default: 0, min: 0, validate: { validator: Number.isSafeInteger, message: 'Price must be a non-negative integer' } },
    permanentlyActive: { type: Boolean, default: true },
    temporarilyUnavailable: { type: Boolean, default: false },
    temporarilyUnavailableUntil: { type: Date, default: null },
}, { timestamps: true })

StoreAddonSchema.index({ storeId: 1, addonId: 1 }, { unique: true })
StoreAddonSchema.index({ storeId: 1, permanentlyActive: 1, temporarilyUnavailable: 1 })
StoreAddonSchema.index({ storeId: 1, temporarilyUnavailable: 1, temporarilyUnavailableUntil: 1 })

export default mongoose.model<IStoreAddon>('StoreAddon', StoreAddonSchema)
