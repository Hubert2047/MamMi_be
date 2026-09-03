import mongoose, { Schema, type Document } from 'mongoose'

export interface IStoreLineGroupConfig extends Document {
    storeId: mongoose.Types.ObjectId
    dailyClosingLineGroupId?: mongoose.Types.ObjectId
    createdAt: Date
    updatedAt: Date
}

const StoreLineGroupConfigSchema = new Schema<IStoreLineGroupConfig>(
    {
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, unique: true, index: true },
        dailyClosingLineGroupId: { type: Schema.Types.ObjectId, ref: 'LineGroup' },
    },
    { timestamps: true },
)

export default mongoose.model<IStoreLineGroupConfig>('StoreLineGroupConfig', StoreLineGroupConfigSchema)
