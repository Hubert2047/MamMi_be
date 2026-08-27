import mongoose, { Schema, type Document } from 'mongoose'

export const lineNotificationTypes = ['daily_closing', 'new_order'] as const
export type LineNotificationType = (typeof lineNotificationTypes)[number]

export interface ILineGroup extends Document {
    lineGroupId: string
    storeId?: mongoose.Types.ObjectId
    name: string
    status: 'pending' | 'active' | 'disabled'
    enabled: boolean
    notificationTypes: LineNotificationType[]
    createdAt: Date
    updatedAt: Date
}

const LineGroupSchema = new Schema<ILineGroup>(
    {
        lineGroupId: { type: String, required: true, unique: true, trim: true },
        storeId: { type: Schema.Types.ObjectId, ref: 'Store' },
        name: { type: String, required: true, trim: true, default: 'LINE group' },
        status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending' },
        enabled: { type: Boolean, default: false },
        notificationTypes: { type: [String], enum: lineNotificationTypes, default: [] },
    },
    { timestamps: true },
)

LineGroupSchema.index({ storeId: 1, status: 1 })

export default mongoose.model<ILineGroup>('LineGroup', LineGroupSchema)
