import mongoose, { Schema, Document } from 'mongoose'

export interface IItem extends Document {
    names: Map<string, string>
    description: Map<string, string>
    variants: Array<LocalizedOption | string>
    categoryId: mongoose.Types.ObjectId
    addons: mongoose.Types.ObjectId[]
    noteOptions: Array<LocalizedOption | string>
}

export interface LocalizedOption {
    id: string
    names: { vi: string; en: string; 'zh-TW': string }
}

const ItemSchema = new Schema<IItem>(
    {
        names: { type: Map, of: String, required: true },
        description: { type: Map, of: String, default: {} },
        // Mixed keeps legacy string arrays readable while the controller normalizes new data.
        variants: { type: [Schema.Types.Mixed], default: [] },
        addons: [{ type: Schema.Types.ObjectId, ref: 'Addon' }],
        categoryId: {
            type: Schema.Types.ObjectId,
            ref: 'Category',
            required: true,
        },
        noteOptions: { type: [Schema.Types.Mixed], default: [] },
    },
    { timestamps: true },
)

export default mongoose.model<IItem>('Item', ItemSchema)
