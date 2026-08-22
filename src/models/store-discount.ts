import mongoose, { Schema, type Document } from 'mongoose'

export interface IStoreDiscount extends Document {
    storeId: mongoose.Types.ObjectId
    discountId: mongoose.Types.ObjectId
    amount: number
    active: boolean
    startsAt?: Date
    endsAt?: Date
}

const StoreDiscountSchema = new Schema<IStoreDiscount>({
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
    discountId: { type: Schema.Types.ObjectId, ref: 'Discount', required: true },
    amount: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
    startsAt: Date,
    endsAt: Date,
}, { timestamps: true })

StoreDiscountSchema.index({ storeId: 1, discountId: 1 }, { unique: true })
StoreDiscountSchema.index({ storeId: 1, active: 1, startsAt: 1, endsAt: 1 })

export default mongoose.model<IStoreDiscount>('StoreDiscount', StoreDiscountSchema)
