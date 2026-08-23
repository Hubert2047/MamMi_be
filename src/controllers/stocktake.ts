import type { Request, Response } from 'express'
import InventoryItem from '../models/inventory-item.js'
import InventoryReceipt from '../models/inventory-receipt.js'
import InventoryAdjustment from '../models/inventory-adjustment.js'
import InventoryStocktake from '../models/inventory-stocktake.js'
import type { AuthRequest } from '../middlewares/auth.js'

async function getStockByItem(storeId: string) {
    const [receipts, adjustments] = await Promise.all([
        InventoryReceipt.aggregate([{ $match: { storeId } }, { $unwind: '$lines' }, { $group: { _id: '$lines.inventoryItemId', quantity: { $sum: '$lines.stockQuantity' } } }]),
        InventoryAdjustment.aggregate([{ $match: { storeId } }, { $group: { _id: '$inventoryItemId', quantity: { $sum: '$stockQuantity' } } }]),
    ])
    const stock = new Map<string, number>()
    for (const row of [...receipts, ...adjustments]) stock.set(String(row._id), (stock.get(String(row._id)) || 0) + row.quantity)
    return stock
}

export const getInventoryStock = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const [items, stock] = await Promise.all([InventoryItem.find({ storeId, active: true }).sort({ name: 1 }).lean(), getStockByItem(String(storeId))])
    res.json({ success: true, data: items.map((item) => ({ ...item, currentQuantity: stock.get(String(item._id)) || 0 })) })
}

export const getInventoryStocktakes = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const stocktakes = await InventoryStocktake.find({ storeId }).sort({ checkedAt: -1 }).populate('lines.inventoryItemId', 'name').lean()
    res.json({ success: true, data: stocktakes })
}

export const createInventoryStocktake = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { checkedAt, lines } = req.body
        if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ success: false, message: 'At least one stocktake line is required' })
        const items = await InventoryItem.find({ _id: { $in: lines.map((line: any) => line.inventoryItemId) }, storeId, active: true }).lean()
        const itemMap = new Map(items.map((item) => [String(item._id), item]))
        const stock = await getStockByItem(String(storeId))
        const normalized = lines.map((line: any) => {
            const item = itemMap.get(String(line.inventoryItemId))
            const actualQuantity = Number(line.actualQuantity)
            if (!item || !Number.isFinite(actualQuantity) || actualQuantity < 0) throw new Error('Invalid stocktake line')
            const systemQuantity = stock.get(String(item._id)) || 0
            return { inventoryItemId: item._id, stockUnitCode: item.stockUnitCode, systemQuantity, actualQuantity, difference: actualQuantity - systemQuantity, reason: line.reason || '' }
        })
        const stocktake = await InventoryStocktake.create({ storeId, checkedAt, lines: normalized })
        const adjustments = normalized.filter((line) => line.difference !== 0).map((line) => ({ storeId, inventoryItemId: line.inventoryItemId, stockQuantity: line.difference, reason: line.reason || 'Stocktake adjustment', stocktakeId: stocktake._id }))
        if (adjustments.length) await InventoryAdjustment.insertMany(adjustments)
        return res.status(201).json({ success: true, data: stocktake })
    } catch (error: any) {
        return res.status(400).json({ success: false, message: error?.message || 'Error creating stocktake' })
    }
}
