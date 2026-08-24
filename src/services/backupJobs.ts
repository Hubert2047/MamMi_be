import type { Types } from 'mongoose'
import BackupJob from '../models/backup-job.js'

export async function enqueueClosingBackup(closingId: Types.ObjectId, storeId: Types.ObjectId) {
    await BackupJob.updateOne(
        { closingId },
        { $setOnInsert: { closingId, storeId, status: 'pending', attempts: 0 } },
        { upsert: true },
    )
}
