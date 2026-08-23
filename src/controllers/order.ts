import type { Request, Response } from 'express'
import Order from '../models/order.js'
import StoreAddon from '../models/store-addon.js'
import StoreItem from '../models/store-item.js'
import Item from '../models/item.js'
import mongoose from 'mongoose'
import { getFromDayUntilNow, getFullDay } from '../utils/index.js'
import { calculateTotal } from '../utils/orderCalculations.js'
import { getPaidAt } from '../utils/orderPaymentCalculations.js'
import { buildPaidOrderFilter } from '../utils/paidOrderFilters.js'
import { assertFinancialPeriodOpen, FinancialPeriodClosedError } from '../services/financialPeriodLock.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'
import DailyClosing from '../models/daily-closing.js'
import Store from '../models/store.js'
import { allocateOrderSequence, getCurrentOrderPeriodId, getNextOrderSequence } from '../services/orderNumber.js'
import { createKitchenPrintJobs } from '../services/printJobs.js'

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

        const catalogItems = await Item.find({ _id: { $in: validItemIds } }).select('variants noteOptions').lean()
        const catalogById = new Map(catalogItems.map((catalogItem: any) => [String(catalogItem._id), catalogItem]))
        const optionName = (option: any) => {
            if (typeof option === 'string') return option
            return option?.names?.vi || option?.names?.en || option?.names?.['zh-TW'] || option?.id || ''
        }

        const normalizedItems = order.items.map((item: any) => ({
            id: item.id,
            itemId: item.itemId,
            name: item.name,
            quantity: item.quantity || 1,
            basePrice: item.basePrice,
            variant: optionName(catalogById.get(String(item.id))?.variants?.find((option: any) => option?.id === item.variant) || item.variant),
            addons: item.addons,
            noteOptions: (item.noteOptions || []).map((selectedOption: any) => optionName(catalogById.get(String(item.id))?.noteOptions?.find((option: any) => option?.id === selectedOption) || selectedOption)),
            note: item.note,
        }))

        const totalPrice = calculateTotal(normalizedItems, order.discount)
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
            discount: order.discount,
            customer: order.customer,
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
        const order = await Order.findOne({ _id: id, storeId }).select({ paidAt: 1 }).lean()
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
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
