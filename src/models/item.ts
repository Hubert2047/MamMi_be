import mongoose, { Schema, Document } from 'mongoose'

export interface IItem extends Document {
    names: Map<string, string>
    variants: string[] | null
    price: Map<string, number>
    categoryId: mongoose.Types.ObjectId
    addons: mongoose.Types.ObjectId[]
    noteOptions: string[]
    active: boolean
}

const ItemSchema = new Schema<IItem>(
    {
        names: { type: Map, of: String, required: true },
        variants: {
            type: [String],
            default: [],
        },
        price: {
            type: Map,
            of: Number,
            required: true,
            default: {},
        },
        addons: [{ type: Schema.Types.ObjectId, ref: 'Addon' }],
        categoryId: {
            type: Schema.Types.ObjectId,
            ref: 'Category',
            required: true,
        },
        noteOptions: [String],
        active: { type: Boolean, default: true },
    },
    { timestamps: true },
)

export default mongoose.model<IItem>('Item', ItemSchema)
