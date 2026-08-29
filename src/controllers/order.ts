import type { Request, Response } from 'express'
import Order from '../models/order.js'
import StoreAddon from '../models/store-addon.js'
import StoreItem from '../models/store-item.js'
import Item from '../models/item.js'
import Addon from '../models/addon.js'
import mongoose from 'mongoose'
import { getFromDayUntilNow, getFullDay } from '../utils/index.js'
import { calculateTotal } from '../utils/orderCalculations.js'
import Promotion from '../models/promotion.js'
import StorePromotion from '../models/store-promotion.js'
import { calculatePromotionPricing, isPromotionAvailableAt, matchesExpectedPromotionPricing, type PricePromotion, type PromotionOrderItem } from '../utils/promotionCalculations.js'
import { getPaidAt } from '../utils/orderPaymentCalculations.js'
import { buildPaidOrderFilter } from '../utils/paidOrderFilters.js'
import { assertFinancialPeriodOpen, FinancialPeriodClosedError } from '../services/financialPeriodLock.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'
import DailyClosing from '../models/daily-closing.js'
import Store from '../models/store.js'
import { allocateOrderSequence, getCurrentOrderPeriodId, getNextOrderSequence } from '../services/orderNumber.js'
import { createKitchenPrintJobs } from '../services/printJobs.js'
import { expireEndedPromotions } from '../services/promotionPricing.js'

const MAX_NOTE_LENGTH = 40

const calculatePromotionsForOrder = async (storeId: string, items: PromotionOrderItem[], selectedPromotionIds: string[] = []) => {
    const now = new Date()
    await expireEndedPromotions(now)
    const configs = await StorePromotion.find({ storeId, enabled: true }).populate('promotionId').lean()
    const promotions: PricePromotion[] = configs.flatMap((config: any) => {
        const promotion = config.promotionId as any
        if (!promotion || !isPromotionAvailableAt(promotion, now)) return []
        return [{ id: String(promotion._id), name: promotion.names.vi || promotion.names.en || promotion.names['zh-TW'], version: promotion.version, mode: promotion.mode, minSubtotal: promotion.minSubtotal, priority: promotion.priority, combinable: promotion.combinable, exclusiveGroup: promotion.exclusiveGroup, rules: promotion.rules.map((rule: any) => ({ target: rule.target, productIds: rule.productIds.map(String), addonIds: rule.addonIds.map(String), reward: rule.reward })) }]
    })
    return calculatePromotionPricing(items, promotions, selectedPromotionIds)
}

export const getNextOrderNumber = async (req: Request, res: Response) => {
    try {
        const nextNumber = await getNextNumber((req as AuthRequest).user.storeId)
        res.json({ success: true, nextNumber })
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get next number', error: err })
    }
}

export const getSalesByPaymentMethod = async (req: Request, res: Response) => {
    try {
        const { start, end } = getFullDay(0)
        const result = await Order.aggregate([
            {
                $match: { ...buildPaidOrderFilter(start, end), storeId: (req as AuthRequest).user.storeId },
            },
            {
                $group: {
                    _id: '$paymentMethod',
                    totalSales: { $sum: '$totalPrice' },
                    count: { $sum: 1 },
                },
            },
        ])

        const salesByMethod: Record<string, { totalSales: number; count: number }> = {}
        result.forEach((r) => {
            salesByMethod[r._id] = { totalSales: r.totalSales, count: r.count }
        })

        res.json({
            success: true,
            data: salesByMethod,
        })
    } catch (error) {
        console.error(error)
        res.status(500).json({
            success: false,
            message: 'Error fetching sales by payment method',
            error,
        })
    }
}

export const getNextNumber = async (storeId: string) => {
    const periodId = await getCurrentOrderPeriodId(storeId)
    return getNextOrderSequence(storeId, periodId)
}

export const createOrder = async (req: Request, res: Response) => {
    try {
        const order = req.body
        const storeId = (req as AuthRequest).user.storeId

        if (!order.items || order.items.length === 0) {
            return res.status(400).json({ success: false, message: 'Items is required' })
        }
        const noteValues = order.items.flatMap((item: any) => [item.note, ...(Array.isArray(item.componentSelections) ? item.componentSelections.map((component: any) => component.note) : [])])
        if (noteValues.some((note: any) => typeof note === 'string' && note.length > MAX_NOTE_LENGTH)) {
            return res.status(400).json({ success: false, code: 'NOTE_TOO_LONG', message: `Notes cannot exceed ${MAX_NOTE_LENGTH} characters` })
        }
        if (order.type === 'dine_in' && !String(order.table || '').trim()) {
            return res.status(400).json({ success: false, code: 'TABLE_REQUIRED', message: 'A table is required for dine-in orders' })
        }

        const itemIds: string[] = [...new Set<string>(order.items.map((item: any) => String(item.id)))]
        const validItemIds = itemIds.filter((id) => mongoose.isValidObjectId(id))
        if (validItemIds.length !== itemIds.length) return res.status(400).json({ success: false, code: 'ITEM_NOT_AVAILABLE', message: 'One or more selected products are no longer available' })
        await StoreItem.updateMany({ storeId, temporarilyUnavailable: true, temporarilyUnavailableUntil: { $lte: new Date() } }, { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } })
        const availableItems = await StoreItem.countDocuments({ storeId, itemId: { $in: validItemIds }, permanentlyActive: { $ne: false }, temporarilyUnavailable: false })
        if (availableItems !== validItemIds.length) return res.status(400).json({ success: false, code: 'ITEM_NOT_AVAILABLE', message: 'One or more selected products are no longer available' })

        if (order.checkoutPending && order._id) {
            const updated = await Order.findByIdAndUpdate(
                { _id: order._id, storeId, version: order.version },
                { $set: { status: 'paid', paymentMethod: order.paymentMethod, paidAt: getPaidAt('paid') }, $inc: { version: 1 } },
                { returnDocument: 'after' },
            )
            if (!updated) {
                return res.status(404).json({ success: false, message: 'Order not found' })
            }
            emitStoreEvent(storeId, 'order.payment.updated', { orderId: String(updated._id), changedFields: ['status', 'paymentMethod'] })
            const nextNumber = await getNextNumber(storeId)
            return res.status(200).json({ success: true, data: nextNumber })
        }

        const addonIds: string[] = [...new Set<string>(order.items.flatMap((item: any) => Array.isArray(item.addons) ? item.addons.map((addon: any) => String(addon.id)) : []))]
        const validAddonIds = addonIds.filter((id) => mongoose.isValidObjectId(id))
        if (validAddonIds.length !== addonIds.length) return res.status(400).json({ success: false, code: 'ADDON_NOT_AVAILABLE', message: 'One or more selected add-ons are no longer available' })
        if (validAddonIds.length) {
            await StoreAddon.updateMany({ storeId, temporarilyUnavailable: true, temporarilyUnavailableUntil: { $lte: new Date() } }, { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } })
            const availableAddons = await StoreAddon.countDocuments({ storeId, addonId: { $in: validAddonIds }, permanentlyActive: { $ne: false }, temporarilyUnavailable: false })
            if (availableAddons !== validAddonIds.length) return res.status(400).json({ success: false, code: 'ADDON_NOT_AVAILABLE', message: 'One or more selected add-ons are no longer available' })
        }

        const addonCatalog = validAddonIds.length
            ? await Addon.find({ _id: { $in: validAddonIds } }).select('names name').lean()
            : []
        const addonById = new Map(addonCatalog.map((addon: any) => [String(addon._id), addon]))
        const catalogItems = await Item.find({ _id: { $in: validItemIds } }).select('names variants noteOptions optionGroups addons').populate('addons', 'names name').lean()
        const catalogById = new Map(catalogItems.map((catalogItem: any) => [String(catalogItem._id), catalogItem]))
        const chineseName = (value: any) => value?.names?.['zh-TW'] || value?.names?.vi || value?.names?.en || value?.name || ''
        const optionName = (option: any) => {
            if (typeof option === 'string') return option
            return chineseName(option) || option?.id || ''
        }

        const normalizedItems = order.items.map((item: any) => {
            const catalogItem = catalogById.get(String(item.id))
            const selectedVariant = catalogItem?.variants?.find((option: any) => option?.id === item.variant) || item.variant
            const selectedNoteOptions = (item.noteOptions || []).map((selectedOption: any) => catalogItem?.noteOptions?.find((option: any) => option?.id === selectedOption) || selectedOption)
            const selectedAddons = (item.addons || []).map((addon: any) => {
                const catalogAddon = addonById.get(String(addon.id)) || catalogItem?.addons?.find((candidate: any) => String(candidate?._id) === String(addon.id))
                return { ...addon, printName: chineseName(catalogAddon) || addon.name }
            })
            const printNoteOptions = selectedNoteOptions.map((selectedOption: any) => optionName(selectedOption))
            const requestedSelections = Array.isArray(item.optionSelections) ? item.optionSelections : []
            const optionSelections = requestedSelections.map((selection: any) => {
                const group = (catalogItem?.optionGroups || []).find((candidate: any) => candidate.id === selection?.groupId)
                const option = group?.options?.find((candidate: any) => candidate.id === selection?.optionId)
                if (!group || !option) throw new Error('Invalid product option selection')
                return { groupId: group.id, optionId: option.id, name: optionName(option) }
            })
            for (const group of catalogItem?.optionGroups || []) {
                if (group.required && !optionSelections.some((selection: any) => selection.groupId === group.id)) throw new Error('Required product option is missing')
                if (group.selection === 'single' && optionSelections.filter((selection: any) => selection.groupId === group.id).length > 1) throw new Error('Only one option may be selected')
            }
            return {
                id: item.id,
                itemId: item.itemId,
                name: item.name,
                quantity: item.quantity || 1,
                basePrice: item.basePrice,
                variant: optionName(selectedVariant),
                addons: selectedAddons,
                noteOptions: printNoteOptions,
                note: item.note,
                printName: chineseName(catalogItem) || item.name,
                printVariant: optionName(selectedVariant),
                printAddons: selectedAddons,
                printNoteOptions,
                optionSelections,
            }
        })

        const selectedPromotionIds = Array.isArray(order.selectedPromotionIds) ? order.selectedPromotionIds.map(String) : []
        if (selectedPromotionIds.length > 1) return res.status(400).json({ success: false, code: 'MANUAL_PROMOTION_LIMIT', message: 'Only one manual promotion may be selected' })
        const pricing = await calculatePromotionsForOrder(storeId, normalizedItems, selectedPromotionIds)
        if (!matchesExpectedPromotionPricing(order.expectedPricing, pricing)) return res.status(409).json({ success: false, code: 'PROMOTION_PRICE_CHANGED', message: 'Promotion pricing changed', data: pricing })
        const totalPrice = pricing.total
        const periodId = await getCurrentOrderPeriodId(storeId)
        const sequence = await allocateOrderSequence(storeId, periodId)

        const newOrder = new Order({
            number: sequence,
            periodId,
            sequence,
            storeId,
            items: normalizedItems,
            totalPrice,
            status: order.status,
            type: order.type,
            paymentMethod: order.paymentMethod,
            appliedPromotions: pricing.appliedPromotions,
            customer: order.customer,
            ...(order.type === 'dine_in' ? { table: String(order.table).trim() } : {}),
            source: order.source || 'pos',
            ...(order.externalOrderId ? { externalOrderId: order.externalOrderId } : {}),
            paidAt: getPaidAt(order.status),
        })

        await newOrder.save()
        if (order.printOnConfirm !== false) {
            try {
                await createKitchenPrintJobs(newOrder)
            } catch (printError) {
                console.error('Failed to queue kitchen print jobs:', printError)
            }
        }
        emitStoreEvent(storeId, 'order.created', { orderId: String(newOrder._id), source: newOrder.source })

        const nextNumber = await getNextNumber(storeId)
        return res.status(201).json({ success: true, data: nextNumber })
    } catch (error) {
        console.error('Error creating order:', error)
        res.status(500).json({ success: false, message: 'Error creating order', error })
    }
}
export const cancelOrder = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)

        const storeId = (req as AuthRequest).user.storeId
        const order = await Order.findOne({ _id: id, storeId })

        if (!order) {
            return res.status(404).json({
                success: false,
                code: 'ORDER_NOT_FOUND',
                message: 'Order not found',
            })
        }

        if (order.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                code: 'ORDER_ALREADY_CANCELLED',
                message: 'Order is already cancelled',
            })
        }

        if (order.paidAt) await assertFinancialPeriodOpen(storeId, order.paidAt)

        const updated = await Order.findOneAndUpdate({ _id: id, storeId, version: req.body.version }, { $set: { status: 'cancelled' }, $inc: { version: 1 } }, { returnDocument: 'after', includeResultMetadata: false })
        if (!updated) return res.status(409).json({ success: false, code: 'ORDER_VERSION_CONFLICT', message: 'Order was changed by another device' })

        emitStoreEvent(storeId, 'order.cancelled', { orderId: String(updated._id), changedFields: ['status'] })

        res.json({
            success: true,
            data: updated,
        })
    } catch (error) {
        if (error instanceof FinancialPeriodClosedError) {
            return res.status(error.statusCode).json({ success: false, code: error.code, message: 'Order belongs to a confirmed closing period and cannot be changed' })
        }
        res.status(500).json({
            success: false,
            message: 'Error cancelling order',
            error,
        })
    }
}

export const getOrders = async (req: Request, res: Response) => {
    try {
        const { days, from, to } = req.query
        const storeId = (req as AuthRequest).user.storeId
        const filter: any = { storeId }
        let paidAtFilter: { $gte?: Date; $gt?: Date; $lte: Date }
        if (from || to) {
            const fromDate = from ? new Date(String(from)) : undefined
            const toDate = to ? new Date(String(to)) : new Date()
            if ((fromDate && Number.isNaN(fromDate.getTime())) || Number.isNaN(toDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid order date range' })
            paidAtFilter = { ...(fromDate ? { $gte: fromDate } : {}), $lte: toDate }
        } else if (days) {
            const daysNumber = Number(days)
            const { start } = getFromDayUntilNow(daysNumber)
            paidAtFilter = { $gte: start, $lte: new Date() }
        } else {
            const [latestClosing, store] = await Promise.all([
                DailyClosing.findOne({ storeId, status: { $ne: 'voided' } }).sort({ periodEnd: -1, createdAt: -1 }).select({ periodEnd: 1 }).lean(),
                Store.findById(storeId).select({ createdAt: 1 }).lean(),
            ])
            paidAtFilter = latestClosing
                ? { $gt: latestClosing.periodEnd, $lte: new Date() }
                : { $gte: store?.createdAt ?? getFromDayUntilNow(0).start, $lte: new Date() }
        }
        filter.$or = [
            { status: 'pending' },
            { status: { $in: ['paid', 'cancelled'] }, paidAt: paidAtFilter },
        ]
        const orders = await Order.find(filter).sort({ createdAt: -1 })
        res.json({ success: true, data: orders })
    } catch (error) {
        console.error(error)
        res.status(500).json({ success: false, message: 'Error fetching orders', error })
    }
}

export const getOrderById = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)

        const order = await Order.findOne({ _id: id, storeId: (req as AuthRequest).user.storeId })

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found',
            })
        }

        res.json({
            success: true,
            data: order,
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching order',
            error,
        })
    }
}

export const printKitchenOrder = async (req: Request, res: Response) => {
    try {
        const order = await Order.findOne({ _id: String(req.params.id), storeId: (req as AuthRequest).user.storeId })
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
        await createKitchenPrintJobs(order)
        res.status(202).json({ success: true, message: 'Kitchen print job queued' })
    } catch (error) {
        console.error('Error queueing kitchen print job:', error)
        res.status(500).json({ success: false, message: 'Error queueing kitchen print job', error })
    }
}

export const updateOrderStatus = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const { status, version } = req.body
        const storeId = (req as AuthRequest).user.storeId
        const order = await Order.findOne({ _id: id, storeId }).select({ paidAt: 1 }).lean()
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
        if (order.paidAt) await assertFinancialPeriodOpen(storeId, order.paidAt)

        const updated = await Order.findOneAndUpdate(
            { _id: id, storeId, version },
            { $set: { status, ...(status === 'paid' ? { paidAt: getPaidAt('paid') } : {}) }, $inc: { version: 1 } },
            { returnDocument: 'after', includeResultMetadata: false },
        )
        if (!updated) return res.status(409).json({ success: false, code: 'ORDER_VERSION_CONFLICT', message: 'Order was changed by another device' })

        emitStoreEvent(storeId, 'order.updated', { orderId: String(updated._id), changedFields: ['status'] })

        res.json({
            success: true,
            data: updated,
        })
    } catch (error) {
        if (error instanceof FinancialPeriodClosedError) {
            return res.status(error.statusCode).json({ success: false, message: error.message })
        }
        res.status(400).json({
            success: false,
            message: 'Error updating order',
            error,
        })
    }
}
export const updateOrderPayment = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const { paymentMethod, version } = req.body
        const storeId = (req as AuthRequest).user.storeId
        const order = await Order.findOne({ _id: id, storeId }).select({ paidAt: 1, status: 1 }).lean()
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
        if (order.status !== 'paid') return res.status(400).json({ success: false, code: 'ORDER_NOT_PAID', message: 'Only paid orders can change payment method' })
        if (order.paidAt) await assertFinancialPeriodOpen(storeId, order.paidAt)
        const updated = await Order.findOneAndUpdate({ _id: id, storeId, version }, { $set: { paymentMethod }, $inc: { version: 1 } }, { returnDocument: 'after', includeResultMetadata: false })
        if (!updated) return res.status(409).json({ success: false, code: 'ORDER_VERSION_CONFLICT', message: 'Order was changed by another device' })

        emitStoreEvent(storeId, 'order.payment.updated', { orderId: String(updated._id), changedFields: ['paymentMethod'] })

        res.json({
            success: true,
            data: updated,
        })
    } catch (error) {
        if (error instanceof FinancialPeriodClosedError) {
            return res.status(error.statusCode).json({ success: false, message: error.message })
        }
        res.status(400).json({
            success: false,
            message: 'Error updating order',
            error,
        })
    }
}

/** Updates a pending order from the POS while preserving its number and financial period. */
export const updatePendingOrder = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const { items, type, table, selectedPromotionIds, expectedPricing, paymentMethod, version } = req.body
        const storeId = (req as AuthRequest).user.storeId

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, code: 'ITEMS_REQUIRED', message: 'Items is required' })
        }
        if (type === 'dine_in' && !String(table || '').trim()) {
            return res.status(400).json({ success: false, code: 'TABLE_REQUIRED', message: 'A table is required for dine-in orders' })
        }

        const itemIds = [...new Set<string>(items.map((item: any) => String(item.id)))]
        const validItemIds = itemIds.filter((itemId) => mongoose.isValidObjectId(itemId))
        if (validItemIds.length !== itemIds.length) return res.status(400).json({ success: false, code: 'ITEM_NOT_AVAILABLE', message: 'One or more selected products are no longer available' })
        await StoreItem.updateMany({ storeId, temporarilyUnavailable: true, temporarilyUnavailableUntil: { $lte: new Date() } }, { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } })
        const availableItems = await StoreItem.countDocuments({ storeId, itemId: { $in: validItemIds }, permanentlyActive: { $ne: false }, temporarilyUnavailable: false })
        if (availableItems !== validItemIds.length) return res.status(400).json({ success: false, code: 'ITEM_NOT_AVAILABLE', message: 'One or more selected products are no longer available' })

        const addonIds = [...new Set<string>(items.flatMap((item: any) => Array.isArray(item.addons) ? item.addons.map((addon: any) => String(addon.id)) : []))]
        const validAddonIds = addonIds.filter((addonId) => mongoose.isValidObjectId(addonId))
        if (validAddonIds.length !== addonIds.length) return res.status(400).json({ success: false, code: 'ADDON_NOT_AVAILABLE', message: 'One or more selected add-ons are no longer available' })
        if (validAddonIds.length) {
            await StoreAddon.updateMany({ storeId, temporarilyUnavailable: true, temporarilyUnavailableUntil: { $lte: new Date() } }, { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } })
            const availableAddons = await StoreAddon.countDocuments({ storeId, addonId: { $in: validAddonIds }, permanentlyActive: { $ne: false }, temporarilyUnavailable: false })
            if (availableAddons !== validAddonIds.length) return res.status(400).json({ success: false, code: 'ADDON_NOT_AVAILABLE', message: 'One or more selected add-ons are no longer available' })
        }

        const selectedIds = Array.isArray(selectedPromotionIds) ? selectedPromotionIds.map(String) : []
        if (selectedIds.length > 1) return res.status(400).json({ success: false, code: 'MANUAL_PROMOTION_LIMIT', message: 'Only one manual promotion may be selected' })
        const pricing = await calculatePromotionsForOrder(storeId, items, selectedIds)
        if (!matchesExpectedPromotionPricing(expectedPricing, pricing)) return res.status(409).json({ success: false, code: 'PROMOTION_PRICE_CHANGED', message: 'Promotion pricing changed', data: pricing })
        const updated = await Order.findOneAndUpdate(
            { _id: id, storeId, status: 'pending', version },
            {
                $set: {
                    items,
                    type,
                    table: type === 'dine_in' ? String(table).trim() : '',
                    appliedPromotions: pricing.appliedPromotions,
                    paymentMethod,
                    totalPrice: pricing.total,
                },
                $inc: { version: 1 },
            },
            { returnDocument: 'after', includeResultMetadata: false },
        )
        if (!updated) return res.status(409).json({ success: false, code: 'ORDER_VERSION_CONFLICT', message: 'Order was changed by another device or is no longer pending' })

        emitStoreEvent(storeId, 'order.updated', { orderId: String(updated._id), changedFields: ['items', 'type', 'table', 'appliedPromotions', 'paymentMethod', 'totalPrice'] })
        res.json({ success: true, data: updated })
    } catch (error) {
        console.error('Error updating pending order:', error)
        res.status(400).json({ success: false, message: 'Error updating order', error })
    }
}
