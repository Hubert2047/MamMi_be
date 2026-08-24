import mongoose, { Document, Schema } from 'mongoose'

export type BackupJobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface IBackupJob extends Document {
    closingId: mongoose.Types.ObjectId
    storeId: mongoose.Types.ObjectId
    status: BackupJobStatus
    attempts: number
    startedAt?: Date
    completedAt?: Date
    leaseExpiresAt?: Date
    nextAttemptAt?: Date
    lastError?: string
    createdAt: Date
    updatedAt: Date
}

const BackupJobSchema = new Schema<IBackupJob>(
    {
        closingId: { type: Schema.Types.ObjectId, ref: 'DailyClosing', required: true, unique: true },
        storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true },
        status: { type: String, enum: ['pending', 'running', 'succeeded', 'failed'], default: 'pending', required: true },
        attempts: { type: Number, default: 0, required: true },
        startedAt: Date,
        completedAt: Date,
        leaseExpiresAt: Date,
        nextAttemptAt: Date,
        lastError: String,
    },
    { timestamps: true },
)

BackupJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 })
BackupJobSchema.index({ status: 1, leaseExpiresAt: 1 })

export default mongoose.model<IBackupJob>('BackupJob', BackupJobSchema)
