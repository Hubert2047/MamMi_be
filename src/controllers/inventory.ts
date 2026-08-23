import type { Request, Response } from 'express'
import InventoryItem from '../models/inventory-item.js'
import InventoryReceipt from '../models/inventory-receipt.js'
import InventoryStocktake from '../models/inventory-stocktake.js'
import InventoryAdjustment from '../models/inventory-adjustment.js'
import Expense from '../models/expense.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'

export const getInventoryItems = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const items = await InventoryItem.find({ storeId, active: true }).sort({ name: 1 }).lean()
    res.json({ success: true, data: items })
}

export const createInventoryItem = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { name, stockUnitCode, purchaseUnits = [], minimumStock = 0, note } = req.body
        if (!name || !stockUnitCode) return res.status(400).json({ success: false, message: 'Name and stock unit are required' })
        const item = await InventoryItem.create({ storeId, name, stockUnitCode, purchaseUnits, minimumStock, note })
        emitStoreEvent(String(storeId), 'inventory.item.updated', { inventoryItemId: String(item._id), changedFields: ['created'] })
        return res.status(201).json({ success: true, data: item })
    } catch (error: any) {
        if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Inventory item already exists' })
        return res.status(500).json({ success: false, message: 'Error creating inventory item' })
    }
}

export const updateInventoryItem = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { name, stockUnitCode, purchaseUnits, minimumStock, note, active } = req.body
        const current = await InventoryItem.findOne({ _id: String(req.params.id), storeId }).select({ stockUnitCode: 1 }).lean()
        if (!current) return res.status(404).json({ success: false, message: 'Inventory item not found' })
        if (stockUnitCode && stockUnitCode !== current.stockUnitCode) {
            const [hasReceipt, hasStocktake, hasAdjustment] = await Promise.all([
                InventoryReceipt.exists({ storeId, 'lines.inventoryItemId': current._id }),
                InventoryStocktake.exists({ storeId, 'lines.inventoryItemId': current._id }),
                InventoryAdjustment.exists({ storeId, inventoryItemId: current._id }),
            ])
            if (hasReceipt || hasStocktake || hasAdjustment) return res.status(400).json({ success: false, message: 'Stock unit cannot be changed after inventory activity' })
        }
        const item = await InventoryItem.findOneAndUpdate({ _id: String(req.params.id), storeId }, { $set: { name, stockUnitCode, purchaseUnits, minimumStock, note, active } }, { new: true, runValidators: true })
        if (!item) return res.status(404).json({ success: false, message: 'Inventory item not found' })
        emitStoreEvent(String(storeId), 'inventory.item.updated', { inventoryItemId: String(item._id), changedFields: ['updated'] })
        return res.json({ success: true, data: item })
    } catch (error: any) {
        if (error?.code === 11000) return res.status(409).json({ success: false, message: 'Inventory item already exists' })
        return res.status(400).json({ success: false, message: 'Invalid inventory item' })
    }
}

export const getInventoryReceipts = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const receipts = await InventoryReceipt.find({ storeId }).sort({ receivedAt: -1 }).populate('lines.inventoryItemId', 'name stockUnitCode').lean()
    res.json({ success: true, data: receipts })
}

export const createInventoryReceipt = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { supplierName, receivedAt, note, lines } = req.body
        if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ success: false, message: 'At least one receipt line is required' })

        const itemIds = lines.map((line: any) => line.inventoryItemId)
        const items = await InventoryItem.find({ _id: { $in: itemIds }, storeId, active: true }).lean()
        const itemMap = new Map(items.map((item) => [String(item._id), item]))
        if (items.length !== new Set(itemIds.map(String)).size) return res.status(400).json({ success: false, message: 'Invalid inventory item' })

        const normalizedLines = lines.map((line: any) => {
            const item = itemMap.get(String(line.inventoryItemId))!
            const quantity = Number(line.quantity)
            const unitPrice = Number(line.unitPrice)
            const purchaseUnit = item.purchaseUnits.find((unit) => unit.unitCode === line.unitCode)
            const conversionFactor = purchaseUnit?.conversionFactor ?? (line.unitCode === item.stockUnitCode ? 1 : 0)
            if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || conversionFactor <= 0) throw new Error('Invalid receipt line')
            return { inventoryItemId: item._id, quantity, unitCode: line.unitCode, conversionFactor, stockQuantity: quantity * conversionFactor, unitPrice, total: quantity * unitPrice }
        })
        const totalAmount = normalizedLines.reduce((sum, line) => sum + line.total, 0)
        const receipt = await InventoryReceipt.create({ storeId, supplierName, receivedAt, note, lines: normalizedLines, totalAmount })
        const itemNames = [...new Set(normalizedLines.map((line) => itemMap.get(String(line.inventoryItemId))?.name).filter(Boolean))]
        const expenseName = itemNames.length === 1 ? itemNames[0] : itemNames.join(', ')
        const expense = await Expense.create({ storeId, name: expenseName || (supplierName ? `Purchase: ${supplierName}` : 'Inventory purchase'), quantity: 1, unit: '', unitPrice: totalAmount, price: totalAmount, type: 'inventory_purchase', category: 'raw_material', receiptId: receipt._id, note })
        await InventoryReceipt.updateOne({ _id: receipt._id }, { $set: { expenseId: expense._id } })
        return res.status(201).json({ success: true, data: { receipt, expense } })
    } catch (error: any) {
        return res.status(400).json({ success: false, message: error?.message || 'Error creating inventory receipt' })
    }
}
