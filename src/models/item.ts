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
    categoryId: mongoose.Types.ObjectId
    addons: mongoose.Types.ObjectId[]
    noteOptions: Array<LocalizedOption | string>
    components: Array<{ itemId: mongoose.Types.ObjectId; quantity: number }>
}

export interface LocalizedOption {
    id: string
    names: { vi: string; en: string; 'zh-TW': string }
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
        addons: [{ type: Schema.Types.ObjectId, ref: 'Addon' }],
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
