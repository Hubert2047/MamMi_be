import mongoose, { Schema, type Document } from 'mongoose'

export interface IStorePromotion extends Document {
    storeId: mongoose.Types.ObjectId
    promotionId: mongoose.Types.ObjectId
    enabled: boolean
}

const StorePromotionSchema = new Schema<IStorePromotion>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    promotionId: { type: Schema.Types.ObjectId, ref: 'Promotion', required: true },
    enabled: { type: Boolean, default: false },
}, { timestamps: true })

StorePromotionSchema.index({ storeId: 1, promotionId: 1 }, { unique: true })
StorePromotionSchema.index({ storeId: 1, enabled: 1 })
export default mongoose.model<IStorePromotion>('StorePromotion', StorePromotionSchema)
