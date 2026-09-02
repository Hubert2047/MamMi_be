import 'dotenv/config'
import mongoose from 'mongoose'

const uri = process.env.MONGO_URI
if (!uri) throw new Error('MONGO_URI not set')

await mongoose.connect(uri, { dbName: 'mammi' })
const collection = mongoose.connection.collection('shiftattendances')
const indexes = await collection.indexes()
const legacyUnique = indexes.find((index) => index.unique && index.key?.numberId === 1 && index.key?.date === 1)
if (legacyUnique?.name) await collection.dropIndex(legacyUnique.name)

const cursor = collection.find({ checkInAt: { $exists: false }, checkIn: { $exists: true } })
let migrated = 0
for await (const legacy of cursor) {
    const sessions = legacy.sessions?.length
        ? legacy.sessions
        : [{ checkIn: legacy.checkIn, ...(legacy.checkOuts?.at(-1) ? { checkOut: legacy.checkOuts.at(-1) } : {}) }]
    for (const session of sessions) {
        if (!session.checkIn) continue
        const checkInAt = new Date(session.checkIn)
        const checkOutAt = session.checkOut ? new Date(session.checkOut) : undefined
        const workingHours = checkOutAt ? Number(((checkOutAt.getTime() - checkInAt.getTime()) / (1000 * 60 * 60)).toFixed(2)) : undefined
        await collection.insertOne({
            employeeId: legacy.employeeId,
            numberId: legacy.numberId,
            checkInAt,
            ...(checkOutAt ? { checkOutAt } : {}),
            workDate: legacy.workDate || legacy.date,
            ...(workingHours !== undefined ? { workingHours } : {}),
            status: checkOutAt ? 'done' : 'working',
            createdAt: legacy.createdAt || checkInAt,
            updatedAt: legacy.updatedAt || new Date(),
        })
        migrated++
    }
    await collection.deleteOne({ _id: legacy._id })
}

console.log(`Migrated ${migrated} attendance sessions`)
await mongoose.disconnect()
