import 'dotenv/config'
import mongoose from 'mongoose'
import InventoryItem from '../models/inventory-item.js'
import InventoryReceipt from '../models/inventory-receipt.js'
import InventoryAdjustment from '../models/inventory-adjustment.js'

const uri = process.env.MONGO_URI
if (!uri) throw new Error('MONGO_URI not set')

await mongoose.connect(uri, { dbName: 'mammi' })
const [receipts, adjustments] = await Promise.all([
  InventoryReceipt.aggregate([{ $unwind: '$lines' }, { $group: { _id: { storeId: '$storeId', inventoryItemId: '$lines.inventoryItemId' }, quantity: { $sum: '$lines.stockQuantity' } } }]),
  InventoryAdjustment.aggregate([{ $group: { _id: { storeId: '$storeId', inventoryItemId: '$inventoryItemId' }, quantity: { $sum: '$stockQuantity' } } }]),
])
const quantities = new Map<string, number>()
for (const row of [...receipts, ...adjustments]) {
  const key = `${row._id.storeId}:${row._id.inventoryItemId}`
  quantities.set(key, (quantities.get(key) || 0) + row.quantity)
}
const items = await InventoryItem.find().select({ _id: 1, storeId: 1 }).lean()
await InventoryItem.bulkWrite(items.map((item) => ({ updateOne: { filter: { _id: item._id }, update: { $set: { currentQuantity: Math.max(0, quantities.get(`${item.storeId}:${item._id}`) || 0) } } } })))
console.log(`Backfilled currentQuantity for ${items.length} inventory items`)
await mongoose.disconnect()
