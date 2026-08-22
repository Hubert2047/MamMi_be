import type { Request, Response } from 'express'
import Order from '../models/order.js'
import { getFromDayUntilNow, getFullDay } from '../utils/index.js'
import { calculateTotal } from '../utils/orderCalculations.js'
import { getPaidAt } from '../utils/orderPaymentCalculations.js'
import { buildPaidOrderFilter } from '../utils/paidOrderFilters.js'
import { assertFinancialPeriodOpen, FinancialPeriodClosedError } from '../services/financialPeriodLock.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'

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
    const lastOrder = await Order.findOne({
        storeId,
    }).sort({ number: -1 })

    return lastOrder ? lastOrder.number + 1 : 1
}

export const createOrder = async (req: Request, res: Response) => {
    try {
        const order = req.body
        const storeId = (req as AuthRequest).user.storeId

        if (!order.items || order.items.length === 0) {
            return res.status(400).json({ success: false, message: 'Items is required' })
        }

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

        const normalizedItems = order.items.map((item: any) => ({
            id: item.id,
            itemId: item.itemId,
            name: item.name,
            quantity: item.quantity || 1,
            basePrice: item.basePrice,
            variant: item.variant,
            addons: item.addons,
            noteOptions: item.noteOptions || [],
            note: item.note,
        }))

        const totalPrice = calculateTotal(normalizedItems, order.discount)

        const newOrder = new Order({
            number: order.number,
            storeId,
            items: normalizedItems,
            totalPrice,
            status: order.status,
            type: order.type,
            paymentMethod: order.paymentMethod,
            discount: order.discount,
            customer: order.customer,
            source: order.source || 'pos',
            externalOrderId: order.externalOrderId,
            paidAt: getPaidAt(order.status),
        })

        await newOrder.save()
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
        const { days } = req.query
        const filter: any = { storeId: (req as AuthRequest).user.storeId }
        if (days) {
            const daysNumber = Number(days)
            const { start } = getFromDayUntilNow(daysNumber)
            filter.createdAt = { $gte: start }
        } else {
            const { start, end } = getFromDayUntilNow(0)
            filter.createdAt = { $gte: start, $lte: end }
        }

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
