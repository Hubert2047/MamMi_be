import mongoose, { type ClientSession } from 'mongoose'
import type { Request, Response } from 'express'
import InventoryItem from '../models/inventory-item.js'
import InventoryReceipt from '../models/inventory-receipt.js'
import InventoryStocktake from '../models/inventory-stocktake.js'
import InventoryAdjustment from '../models/inventory-adjustment.js'
import Expense from '../models/expense.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'

type ReceiptInputLine = { inventoryItemId: string; quantity: number; unitCode: string; unitPrice: number }

async function normalizeReceiptLines(storeId: string, lines: ReceiptInputLine[]) {
    if (!Array.isArray(lines) || !lines.length) throw new Error('At least one receipt line is required')
    const itemIds = lines.map((line) => line.inventoryItemId)
    const items = await InventoryItem.find({ _id: { $in: itemIds }, storeId, active: true }).lean()
    const itemMap = new Map(items.map((item) => [String(item._id), item]))
    if (items.length !== new Set(itemIds.map(String)).size) throw new Error('Invalid inventory item')
    const normalized = lines.map((line) => {
        const item = itemMap.get(String(line.inventoryItemId))!
        const quantity = Number(line.quantity)
        const unitPrice = Number(line.unitPrice)
        const purchaseUnit = item.purchaseUnits.find((unit) => unit.unitCode === line.unitCode)
        const conversionFactor = purchaseUnit?.conversionFactor ?? 0
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || conversionFactor <= 0) throw new Error('Invalid receipt line')
        return { inventoryItemId: item._id, quantity, unitCode: line.unitCode, conversionFactor, stockQuantity: quantity * conversionFactor, unitPrice, total: quantity * unitPrice }
    })
    return { normalized, itemMap }
}

function stockDeltas(lines: Array<{ inventoryItemId: unknown; stockQuantity: number }>, multiplier = 1) {
    const deltas = new Map<string, number>()
    for (const line of lines) deltas.set(String(line.inventoryItemId), (deltas.get(String(line.inventoryItemId)) || 0) + line.stockQuantity * multiplier)
    return deltas
}

async function applyStockDeltas(storeId: string, deltas: Map<string, number>, session: ClientSession) {
    await Promise.all([...deltas].filter(([, delta]) => delta !== 0).map(([id, delta]) => InventoryItem.updateOne({ _id: id, storeId }, { $inc: { currentQuantity: delta } }, { session })))
}

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
    const session = await mongoose.startSession()
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { supplierName, receivedAt, note, lines } = req.body
        const { normalized: normalizedLines, itemMap } = await normalizeReceiptLines(String(storeId), lines)
        const totalAmount = normalizedLines.reduce((sum, line) => sum + line.total, 0)
        const itemNames = [...new Set(normalizedLines.map((line) => itemMap.get(String(line.inventoryItemId))?.name).filter(Boolean))]
        const expenseName = itemNames.length === 1 ? itemNames[0] : itemNames.join(', ')
        let receipt: any; let expense: any
        await session.withTransaction(async () => {
            receipt = (await InventoryReceipt.create([{ storeId, supplierName, receivedAt, note, lines: normalizedLines, totalAmount }], { session }))[0]
            expense = (await Expense.create([{ storeId, name: expenseName || (supplierName ? `Purchase: ${supplierName}` : 'Inventory purchase'), quantity: 1, unit: '', unitPrice: totalAmount, price: totalAmount, type: 'inventory_purchase', category: 'raw_material', receiptId: receipt._id, note }], { session }))[0]
            await InventoryReceipt.updateOne({ _id: receipt._id }, { $set: { expenseId: expense._id } }, { session })
            await applyStockDeltas(String(storeId), stockDeltas(normalizedLines), session)
        })
        return res.status(201).json({ success: true, data: { receipt, expense } })
    } catch (error: any) {
        return res.status(400).json({ success: false, message: error?.message || 'Error creating inventory receipt' })
    } finally { await session.endSession() }
}

export const updateInventoryReceipt = async (req: Request, res: Response) => {
    const session = await mongoose.startSession()
    try {
        const storeId = String((req as AuthRequest).user.storeId)
        const receipt = await InventoryReceipt.findOne({ _id: String(req.params.id), storeId }).lean()
        if (!receipt) return res.status(404).json({ success: false, message: 'Inventory receipt not found' })
        const { supplierName, receivedAt, note, lines } = req.body
        const { normalized: normalizedLines, itemMap } = await normalizeReceiptLines(storeId, lines)
        const totalAmount = normalizedLines.reduce((sum, line) => sum + line.total, 0)
        const itemNames = [...new Set(normalizedLines.map((line) => itemMap.get(String(line.inventoryItemId))?.name).filter(Boolean))]
        const deltas = stockDeltas(receipt.lines, -1)
        for (const [id, quantity] of stockDeltas(normalizedLines)) deltas.set(id, (deltas.get(id) || 0) + quantity)
        const receiptUpdates: Record<string, unknown> = { lines: normalizedLines, totalAmount }
        if (supplierName !== undefined) receiptUpdates.supplierName = supplierName
        if (receivedAt !== undefined) receiptUpdates.receivedAt = receivedAt
        if (note !== undefined) receiptUpdates.note = note
        const expenseUpdates: Record<string, unknown> = { name: itemNames.join(', ') || 'Inventory purchase', unitPrice: totalAmount, price: totalAmount }
        if (note !== undefined) expenseUpdates.note = note
        await session.withTransaction(async () => {
            await applyStockDeltas(storeId, deltas, session)
            await InventoryReceipt.updateOne({ _id: receipt._id }, { $set: receiptUpdates }, { session })
            if (receipt.expenseId) await Expense.updateOne({ _id: receipt.expenseId, storeId, type: 'inventory_purchase' }, { $set: expenseUpdates }, { session })
        })
        return res.json({ success: true })
    } catch (error: any) {
        return res.status(400).json({ success: false, message: error?.message || 'Error updating inventory receipt' })
    } finally { await session.endSession() }
}

export const deleteInventoryReceipt = async (req: Request, res: Response) => {
    const session = await mongoose.startSession()
    try {
        const storeId = String((req as AuthRequest).user.storeId)
        const receipt = await InventoryReceipt.findOne({ _id: String(req.params.id), storeId }).lean()
        if (!receipt) return res.status(404).json({ success: false, message: 'Inventory receipt not found' })
        await session.withTransaction(async () => {
            await applyStockDeltas(storeId, stockDeltas(receipt.lines, -1), session)
            await InventoryReceipt.deleteOne({ _id: receipt._id }, { session })
            if (receipt.expenseId) await Expense.deleteOne({ _id: receipt.expenseId, storeId }, { session })
        })
        return res.json({ success: true })
    } catch (error: any) {
        return res.status(400).json({ success: false, message: error?.message || 'Error deleting inventory receipt' })
    } finally { await session.endSession() }
}
