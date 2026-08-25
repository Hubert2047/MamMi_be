import mongoose, { Schema, type Document } from 'mongoose'

export interface IStore extends Document {
    code: string
    name: string
    isMain: boolean
    active: boolean
    timezone: string
    createdAt: Date
    updatedAt: Date
}

const StoreSchema = new Schema<IStore>(
    {
        code: { type: String, required: true, unique: true, trim: true, lowercase: true },
        name: { type: String, required: true, trim: true },
        isMain: { type: Boolean, default: false },
        active: { type: Boolean, default: true },
        timezone: { type: String, default: 'Asia/Taipei' },
    },
    { timestamps: true },
)

StoreSchema.index({ isMain: 1 }, { unique: true, partialFilterExpression: { isMain: true } })

export default mongoose.model<IStore>('Store', StoreSchema)
