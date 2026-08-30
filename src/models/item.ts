import mongoose, { Schema, Document } from 'mongoose'

export interface IItem extends Document {
    type: 'product' | 'combo'
    names: Map<string, string>
    description: Map<string, string>
    imageUrl?: string
    imagePublicId?: string
    recommended: boolean
    popular: boolean
    new: boolean
    variants: Array<LocalizedOption | string>
    optionGroups: OptionGroup[]
    categoryId: mongoose.Types.ObjectId
    addons: mongoose.Types.ObjectId[]
    addonConfigs: Array<{ addonId: mongoose.Types.ObjectId; maxQuantity: number | null }>
    noteOptions: Array<LocalizedOption | string>
    components: Array<{ itemId: mongoose.Types.ObjectId; quantity: number }>
}

export interface LocalizedOption {
    id: string
    names: { vi: string; en: string; 'zh-TW': string }
}

export interface OptionGroup {
    id: string
    names: { vi: string; en: string; 'zh-TW': string }
    selection: 'single' | 'multiple'
    required: boolean
    defaultOptionId?: string
    options: LocalizedOption[]
}

const ItemSchema = new Schema<IItem>(
    {
        type: { type: String, enum: ['product', 'combo'], default: 'product' },
        names: { type: Map, of: String, required: true },
        description: { type: Map, of: String, default: {} },
        imageUrl: { type: String, trim: true },
        imagePublicId: { type: String, trim: true },
        recommended: { type: Boolean, default: false },
        popular: { type: Boolean, default: false },
        new: { type: Boolean, default: false },
        // Mixed keeps legacy string arrays readable while the controller normalizes new data.
        variants: { type: [Schema.Types.Mixed], default: [] },
        optionGroups: { type: Schema.Types.Mixed, default: [] },
        addons: [{ type: Schema.Types.ObjectId, ref: 'Addon' }],
        addonConfigs: [{
            addonId: { type: Schema.Types.ObjectId, ref: 'Addon', required: true },
            maxQuantity: { type: Number, min: 1, default: 1 },
        }],
        categoryId: {
            type: Schema.Types.ObjectId,
            ref: 'Category',
            required: true,
        },
        noteOptions: { type: [Schema.Types.Mixed], default: [] },
        components: [{ itemId: { type: Schema.Types.ObjectId, ref: 'Item', required: true }, quantity: { type: Number, min: 1, default: 1 } }],
    },
    { timestamps: true },
)

export default mongoose.model<IItem>('Item', ItemSchema)
