import 'dotenv/config'
import mongoose from 'mongoose'
import LineGroup from '../models/line-group.js'

const uri = process.env.MONGO_URI
if (!uri) throw new Error('MONGO_URI not set')

await mongoose.connect(uri, { dbName: 'mammi' })

try {
    const duplicates = await LineGroup.aggregate([
        { $group: { _id: '$name', count: { $sum: 1 }, groupIds: { $push: '$_id' } } },
        { $match: { count: { $gt: 1 } } },
    ])
    if (duplicates.length) {
        throw new Error(`Cannot create unique LINE group name index because duplicate names exist: ${JSON.stringify(duplicates)}`)
    }

    await LineGroup.updateMany(
        {},
        { $unset: { status: '', enabled: '', notificationTypes: '' } },
    )

    const indexes = await LineGroup.collection.listIndexes().toArray()
    for (const index of indexes) {
        const isNameIndex = index.key && Object.keys(index.key).length === 1 && index.key.name === 1
        if (isNameIndex && index.name !== 'unique_line_group_name') {
            await LineGroup.collection.dropIndex(index.name as string)
        }
    }

    await LineGroup.collection.createIndex(
        { name: 1 },
        { unique: true, name: 'unique_line_group_name' },
    )
    console.log('Migrated LINE groups: removed legacy fields and created unique name index')
} finally {
    await mongoose.disconnect()
}
