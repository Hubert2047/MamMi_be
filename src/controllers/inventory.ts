import mongoose, { type ClientSession } from 'mongoose'
import type { Request, Response } from 'express'
import InventoryItem from '../models/inventory-item.js'
import IngredientSupplier from '../models/ingredient-supplier.js'
import Supplier from '../models/supplier.js'
import InventoryReceipt from '../models/inventory-receipt.js'
import InventoryStocktake from '../models/inventory-stocktake.js'
import Expense from '../models/expense.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'

type ReceiptInputLine = { inventoryItemId: string; quantity: number; unitCode: string; unitPrice: number }

type SupplierConfig = { supplierIds?: unknown; defaultSupplierId?: unknown }

async function validateSupplierConfig(storeId: string, config: SupplierConfig) {
    const supplierIds = Array.isArray(config.supplierIds)
        ? [...new Set(config.supplierIds.map(String).filter((id) => mongoose.isValidObjectId(id)))]
        : []
    if (Array.isArray(config.supplierIds) && supplierIds.length !== config.supplierIds.length) throw new Error('Invalid supplier')
    const defaultSupplierId = config.defaultSupplierId ? String(config.defaultSupplierId) : null
    if (defaultSupplierId && (!mongoose.isValidObjectId(defaultSupplierId) || !supplierIds.includes(defaultSupplierId))) {
        throw new Error('Default supplier must be selected')
    }
    const suppliers = await Supplier.find({ _id: { $in: supplierIds }, storeId }).select({ _id: 1 }).lean()
    if (suppliers.length !== supplierIds.length) throw new Error('Invalid supplier')
    return { supplierIds, defaultSupplierId }
}

async function syncIngredientSuppliers(storeId: string, inventoryItemId: mongoose.Types.ObjectId, config: SupplierConfig) {
    const normalized = await validateSupplierConfig(storeId, config)
    await IngredientSupplier.deleteMany({ storeId, inventoryItemId })
    if (normalized.supplierIds.length) {
        await IngredientSupplier.insertMany(normalized.supplierIds.map((supplierId) => ({
            storeId,
            inventoryItemId,
            supplierId,
            isDefault: supplierId === normalized.defaultSupplierId,
        })))
    }
}

async function normalizeReceiptLines(storeId: string, lines: ReceiptInputLine[], allowPendingUnitFallback = false) {
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
        const pendingUnitFallback = allowPendingUnitFallback && !purchaseUnit
        const resolvedUnitCode = pendingUnitFallback ? item.stockUnitCode : line.unitCode
        const conversionFactor = purchaseUnit?.conversionFactor ?? 0
        const resolvedConversionFactor = pendingUnitFallback ? 1 : conversionFactor
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || resolvedConversionFactor <= 0) throw new Error('Invalid receipt line')
        return { inventoryItemId: item._id, quantity, unitCode: resolvedUnitCode, conversionFactor: resolvedConversionFactor, stockQuantity: quantity * resolvedConversionFactor, unitPrice, total: quantity * unitPrice }
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
    const links = await IngredientSupplier.find({ storeId, inventoryItemId: { $in: items.map((item) => item._id) } }).lean()
    const linksByItem = new Map<string, typeof links>()
    for (const link of links) linksByItem.set(String(link.inventoryItemId), [...(linksByItem.get(String(link.inventoryItemId)) ?? []), link])
    res.json({ success: true, data: items.map((item) => {
        const itemLinks = linksByItem.get(String(item._id)) ?? []
        return { ...item, supplierIds: itemLinks.map((link) => String(link.supplierId)), defaultSupplierId: itemLinks.find((link) => link.isDefault)?.supplierId?.toString() ?? null }
    }) })
}

export const createInventoryItem = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { name, stockUnitCode, purchaseUnits = [], minimumStock = 0, note, inventoryStatus = 'active', supplierIds, defaultSupplierId } = req.body
        if (!name || !stockUnitCode) return res.status(400).json({ success: false, message: 'Name and stock unit are required' })
        const normalizedSuppliers = await validateSupplierConfig(String(storeId), { supplierIds, defaultSupplierId })
        const item = await InventoryItem.create({ storeId, name, stockUnitCode, purchaseUnits, minimumStock, note, inventoryStatus })
        await syncIngredientSuppliers(String(storeId), item._id, normalizedSuppliers)
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
        const { name, stockUnitCode, purchaseUnits, minimumStock, note, active, inventoryStatus, supplierIds, defaultSupplierId } = req.body
        const current = await InventoryItem.findOne({ _id: String(req.params.id), storeId }).select({ stockUnitCode: 1 }).lean()
        if (!current) return res.status(404).json({ success: false, message: 'Inventory item not found' })
        const normalizedSuppliers = await validateSupplierConfig(String(storeId), { supplierIds, defaultSupplierId })
        if (stockUnitCode && stockUnitCode !== current.stockUnitCode) {
            const [hasReceipt, hasStocktake] = await Promise.all([
                InventoryReceipt.exists({ storeId, inventoryStatus: { $ne: 'pending' }, 'lines.inventoryItemId': current._id }),
                InventoryStocktake.exists({ storeId, 'lines.inventoryItemId': current._id }),
            ])
            if (hasReceipt || hasStocktake) return res.status(400).json({ success: false, message: 'Stock unit cannot be changed after inventory activity' })
        }
        const updates = { name, stockUnitCode, purchaseUnits, minimumStock, note, active, ...(inventoryStatus ? { inventoryStatus } : {}) }
        const item = await InventoryItem.findOneAndUpdate({ _id: String(req.params.id), storeId }, { $set: updates }, { new: true, runValidators: true })
        if (!item) return res.status(404).json({ success: false, message: 'Inventory item not found' })
        await syncIngredientSuppliers(String(storeId), item._id, normalizedSuppliers)
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
        const { supplierName, receivedAt, note, lines, paymentMethod = 'cash' } = req.body
        const { normalized: normalizedLines, itemMap } = await normalizeReceiptLines(String(storeId), lines)
        const totalAmount = normalizedLines.reduce((sum, line) => sum + line.total, 0)
        const itemNames = [...new Set(normalizedLines.map((line) => itemMap.get(String(line.inventoryItemId))?.name).filter(Boolean))]
        const expenseName = itemNames.length === 1 ? itemNames[0] : itemNames.join(', ')
        let receipt: any; let expense: any
        await session.withTransaction(async () => {
            const hasPendingItem = [...itemMap.values()].some((item: any) => item.inventoryStatus === 'pending')
            receipt = (await InventoryReceipt.create([{ storeId, supplierName, receivedAt, note, lines: normalizedLines, totalAmount, inventoryStatus: hasPendingItem ? 'pending' : 'posted' }], { session }))[0]
            expense = (await Expense.create([{ storeId, name: expenseName || (supplierName ? `Purchase: ${supplierName}` : 'Inventory purchase'), quantity: 1, unit: '', unitPrice: totalAmount, price: totalAmount, type: 'inventory_purchase', category: 'raw_material', paymentMethod, receiptId: receipt._id, note }], { session }))[0]
            await InventoryReceipt.updateOne({ _id: receipt._id }, { $set: { expenseId: expense._id } }, { session })
            if (receipt.inventoryStatus !== 'pending') await applyStockDeltas(String(storeId), stockDeltas(normalizedLines), session)
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
        const deltas = receipt.inventoryStatus !== 'pending' ? stockDeltas(receipt.lines, -1) : new Map<string, number>()
        if (receipt.inventoryStatus !== 'pending') for (const [id, quantity] of stockDeltas(normalizedLines)) deltas.set(id, (deltas.get(id) || 0) + quantity)
        const receiptUpdates: Record<string, unknown> = { lines: normalizedLines, totalAmount }
        if (supplierName !== undefined) receiptUpdates.supplierName = supplierName
        if (receivedAt !== undefined) receiptUpdates.receivedAt = receivedAt
        if (note !== undefined) receiptUpdates.note = note
        const expenseUpdates: Record<string, unknown> = { name: itemNames.join(', ') || 'Inventory purchase', unitPrice: totalAmount, price: totalAmount }
        if (note !== undefined) expenseUpdates.note = note
        await session.withTransaction(async () => {
            if (receipt.inventoryStatus !== 'pending') await applyStockDeltas(storeId, deltas, session)
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
            if (receipt.inventoryStatus !== 'pending') await applyStockDeltas(storeId, stockDeltas(receipt.lines, -1), session)
            await InventoryReceipt.deleteOne({ _id: receipt._id }, { session })
            if (receipt.expenseId) await Expense.deleteOne({ _id: receipt.expenseId, storeId }, { session })
        })
        return res.json({ success: true })
    } catch (error: any) {
        return res.status(400).json({ success: false, message: error?.message || 'Error deleting inventory receipt' })
    } finally { await session.endSession() }
}

export const approveInventoryReceipt = async (req: Request, res: Response) => {
    const session = await mongoose.startSession()
    try {
        const storeId = String((req as AuthRequest).user.storeId)
        const receipt = await InventoryReceipt.findOne({ _id: String(req.params.id), storeId }).lean()
        if (!receipt) return res.status(404).json({ success: false, message: 'Inventory receipt not found' })
        if (receipt.inventoryStatus === 'posted') return res.json({ success: true, data: receipt })
        const { normalized: lines } = await normalizeReceiptLines(storeId, receipt.lines.map((line: any) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity, unitCode: line.unitCode, unitPrice: line.unitPrice })), true)
        await session.withTransaction(async () => {
            const itemIds = lines.map((line) => line.inventoryItemId)
            await InventoryItem.updateMany({ _id: { $in: itemIds }, storeId, inventoryStatus: 'pending' }, { $set: { inventoryStatus: 'active' } }, { session })
            await InventoryReceipt.updateOne({ _id: receipt._id, storeId }, { $set: { lines, inventoryStatus: 'posted', totalAmount: lines.reduce((sum, line) => sum + line.total, 0) } }, { session })
            await applyStockDeltas(storeId, stockDeltas(lines), session)
        })
        return res.json({ success: true, data: { ...receipt, lines, inventoryStatus: 'posted' } })
    } catch (error: any) {
        return res.status(400).json({ success: false, message: error?.message || 'Error approving inventory receipt' })
    } finally { await session.endSession() }
}
