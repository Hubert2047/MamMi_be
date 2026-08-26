import 'dotenv/config'
import mongoose from 'mongoose'
import Item from '../models/item.js'
import Category from '../models/category.js'

const uri = process.env.MONGO_URI
if (!uri) throw new Error('MONGO_URI not set')

await mongoose.connect(uri, { dbName: 'mammi' })
const result = await Item.updateMany({ type: { $exists: false } }, { $set: { type: 'product', components: [] } })
const comboCategory = await Category.findOne({ 'names.vi': 'Combo' }).lean()
if (!comboCategory) await Category.create({ names: { vi: 'Combo', en: 'Combo', 'zh-TW': '套餐' } })
console.log(`Backfilled ${result.modifiedCount} items and ensured Combo category`)
await mongoose.disconnect()
