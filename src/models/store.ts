import mongoose, { Schema, type Document } from 'mongoose'

export interface IStore extends Document {
    code: string
    name: string
    active: boolean
    timezone: string
    createdAt: Date
    updatedAt: Date
}

const StoreSchema = new Schema<IStore>(
    {
        code: { type: String, required: true, unique: true, trim: true, lowercase: true },
        name: { type: String, required: true, trim: true },
        active: { type: Boolean, default: true },
        timezone: { type: String, default: 'Asia/Taipei' },
    },
    { timestamps: true },
)

export default mongoose.model<IStore>('Store', StoreSchema)
