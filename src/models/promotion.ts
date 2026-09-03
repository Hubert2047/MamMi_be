import mongoose, { Schema, type Document } from 'mongoose'

export type PromotionRuleTarget = 'order' | 'product' | 'addon' | 'line'
export interface IPromotion extends Document {
    names: { vi: string; en: string; 'zh-TW': string }
    imageUrl?: string
    imagePublicId?: string
    mode: 'automatic' | 'manual'
    minSubtotal?: number
    priority: number
    combinable: boolean
    exclusiveGroup?: string
    rules: { target: PromotionRuleTarget; productIds: mongoose.Types.ObjectId[]; addonIds: mongoose.Types.ObjectId[]; reward: { type: 'percent' | 'value'; amount: number } }[]
    status: 'draft' | 'active' | 'expired' | 'archived'
    version: number
    startsAt?: Date
    endsAt?: Date
}

const PromotionRewardSchema = new Schema({
    type: { type: String, enum: ['percent', 'value'], required: true },
    amount: { type: Number, required: true, min: 0, validate: { validator: function(this: { type: string }, amount: number) { return this.type === 'percent' ? Number.isFinite(amount) && amount <= 100 : Number.isSafeInteger(amount) }, message: 'Promotion money must be a non-negative integer' } },
}, { _id: false })

const PromotionRuleSchema = new Schema({
    target: { type: String, enum: ['order', 'product', 'addon', 'line'], required: true },
    productIds: [{ type: Schema.Types.ObjectId, ref: 'Item' }],
    addonIds: [{ type: Schema.Types.ObjectId, ref: 'Addon' }],
    reward: { type: PromotionRewardSchema, required: true },
}, { _id: false })

const PromotionSchema = new Schema<IPromotion>({
    names: { vi: { type: String, default: '' }, en: { type: String, default: '' }, 'zh-TW': { type: String, default: '' } },
    imageUrl: { type: String, trim: true },
    imagePublicId: { type: String, trim: true },
    mode: { type: String, enum: ['automatic', 'manual'], required: true },
    minSubtotal: { type: Number, min: 0, validate: { validator: Number.isSafeInteger, message: 'Minimum subtotal must be a non-negative integer' } },
    priority: { type: Number, default: 0 },
    combinable: { type: Boolean, default: false },
    exclusiveGroup: { type: String, trim: true },
    rules: { type: [PromotionRuleSchema], validate: [(rules: unknown[]) => rules.length > 0, 'A promotion needs at least one rule'] },
    status: { type: String, enum: ['draft', 'active', 'expired', 'archived'], default: 'draft' },
    version: { type: Number, default: 1 },
    startsAt: Date,
    endsAt: Date,
}, { timestamps: true })

PromotionSchema.index({ status: 1, startsAt: 1, endsAt: 1 })
export default mongoose.model<IPromotion>('Promotion', PromotionSchema)
