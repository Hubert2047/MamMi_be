import 'dotenv/config'
import mongoose from 'mongoose'
import StoreItem from '../models/store-item.js'
import Item from '../models/item.js'

const uri = process.env.MONGO_URI
if (!uri) throw new Error('MONGO_URI not set')

await mongoose.connect(uri, { dbName: 'mammi' })

const [pos, qr, online, addonDisplayMode, addonConfigs] = await Promise.all([
    StoreItem.updateMany({ 'visibility.pos': { $exists: false } }, { $set: { 'visibility.pos': true } }),
    StoreItem.updateMany({ 'visibility.qr': { $exists: false } }, { $set: { 'visibility.qr': true } }),
    StoreItem.updateMany({ 'visibility.online': { $exists: false } }, { $set: { 'visibility.online': true } }),
    StoreItem.updateMany({ addonDisplayMode: { $exists: false } }, { $set: { addonDisplayMode: 'named' } }),
    Item.updateMany(
        { addonConfigs: { $exists: false } },
        [{ $set: { addonConfigs: { $map: { input: { $ifNull: ['$addons', []] }, as: 'addonId', in: { addonId: '$$addonId', maxQuantity: 1 } } } } }],
    ),
])

console.log(`Backfilled sales configuration: POS ${pos.modifiedCount}, QR ${qr.modifiedCount}, online ${online.modifiedCount}, addon display ${addonDisplayMode.modifiedCount}, addon limits ${addonConfigs.modifiedCount}`)
await mongoose.disconnect()
