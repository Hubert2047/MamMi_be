import Item from '../models/item.js'
import StoreItem from '../models/store-item.js'
import mongoose from 'mongoose'
import Order from '../models/order.js'
import Expense from '../models/expense.js'
import Revenue from '../models/revenue.js'
import DailyClosing from '../models/daily-closing.js'
import Addon from '../models/addon.js'
import StoreAddon from '../models/store-addon.js'

export async function ensureStoreCatalog(storeId: string): Promise<void> {
    const storeObjectId = new mongoose.Types.ObjectId(storeId)
    const items = await Item.find().select({ _id: 1, price: 1, active: 1 }).lean()
    if (!items.length) return
    await StoreItem.bulkWrite(
        items.map((item: any) => ({
            updateOne: {
                filter: { storeId: storeObjectId, itemId: item._id },
                update: { $setOnInsert: { storeId: storeObjectId, itemId: item._id, price: item.price || {}, active: item.active !== false } },
                upsert: true,
            },
        })),
        { ordered: false },
    )
}

export async function ensureStoreAddons(storeId: string): Promise<void> {
    const storeObjectId = new mongoose.Types.ObjectId(storeId)
    const addons = await Addon.find().select({ _id: 1, priceExtra: 1, active: 1 }).lean()
    if (!addons.length) return
    await StoreAddon.bulkWrite(addons.map((addon: any) => ({
        updateOne: {
            filter: { storeId: storeObjectId, addonId: addon._id },
            update: { $setOnInsert: { storeId: storeObjectId, addonId: addon._id, priceExtra: addon.priceExtra, active: addon.active !== false } },
            upsert: true,
        },
    })), { ordered: false })
}

export async function ensureStoreScopedFinancialData(storeId: string): Promise<void> {
    const storeObjectId = new mongoose.Types.ObjectId(storeId)
    await Promise.all([
        Order.updateMany({ storeId: { $exists: false } }, { $set: { storeId: storeObjectId, source: 'pos', version: 1 } }),
        Expense.updateMany({ storeId: { $exists: false } }, { $set: { storeId: storeObjectId } }),
        Revenue.updateMany({ storeId: { $exists: false } }, { $set: { storeId: storeObjectId } }),
        DailyClosing.updateMany({ storeId: { $exists: false } }, { $set: { storeId: storeObjectId } }),
    ])
}
