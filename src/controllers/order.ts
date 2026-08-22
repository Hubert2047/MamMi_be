import type { Request, Response } from 'express'
import Order from '../models/order.js'
import { getFromDayUntilNow, getFullDay } from '../utils/index.js'
import { calculateTotal } from '../utils/orderCalculations.js'
import { getPaidAt } from '../utils/orderPaymentCalculations.js'
import { buildPaidOrderFilter } from '../utils/paidOrderFilters.js'
import { assertFinancialPeriodOpen, FinancialPeriodClosedError } from '../services/financialPeriodLock.js'

export const getNextOrderNumber = async (req: Request, res: Response) => {
    try {
        const nextNumber = await getNextNumber()
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
                $match: buildPaidOrderFilter(start, end),
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

export const getNextNumber = async () => {
    const { start, end } = getFullDay(0)
    const lastOrder = await Order.findOne({
        createdAt: { $gte: start, $lte: end },
    }).sort({ number: -1 })

    return lastOrder ? lastOrder.number + 1 : 1
}

export const createOrder = async (req: Request, res: Response) => {
    try {
        const order = req.body

        if (!order.items || order.items.length === 0) {
            return res.status(400).json({ success: false, message: 'Items is required' })
        }

        if (order.checkoutPending && order._id) {
            const updated = await Order.findByIdAndUpdate(
                order._id,
                { status: 'paid', paymentMethod: order.paymentMethod, paidAt: getPaidAt('paid') },
                { returnDocument: 'after' },
            )
            if (!updated) {
                return res.status(404).json({ success: false, message: 'Order not found' })
            }
            const nextNumber = await getNextNumber()
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
            items: normalizedItems,
            totalPrice,
            status: order.status,
            type: order.type,
            paymentMethod: order.paymentMethod,
            discount: order.discount,
            customer: order.customer,
            paidAt: getPaidAt(order.status),
        })

        await newOrder.save()

        const nextNumber = await getNextNumber()
        return res.status(201).json({ success: true, data: nextNumber })
    } catch (error) {
        console.error('Error creating order:', error)
        res.status(500).json({ success: false, message: 'Error creating order', error })
    }
}
export const cancelOrder = async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        const order = await Order.findById(id)

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found',
            })
        }

        if (order.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: 'Order is already cancelled',
            })
        }

        if (order.paidAt) await assertFinancialPeriodOpen(order.paidAt)

        const updated = await Order.findByIdAndUpdate(id, { status: 'cancelled' }, { returnDocument: 'after' })

        res.json({
            success: true,
            data: updated,
        })
    } catch (error) {
        if (error instanceof FinancialPeriodClosedError) {
            return res.status(error.statusCode).json({ success: false, message: error.message })
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
        const filter: any = {}
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
        const { id } = req.params

        const order = await Order.findById(id)

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
        const { id } = req.params
        const { status } = req.body
        const order = await Order.findById(id).select({ paidAt: 1 }).lean()
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
        if (order.paidAt) await assertFinancialPeriodOpen(order.paidAt)

        const updated = await Order.findByIdAndUpdate(
            id,
            { status, ...(status === 'paid' ? { paidAt: getPaidAt('paid') } : {}) },
            { returnDocument: 'after' },
        )

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
        const { id } = req.params
        const { paymentMethod } = req.body
        const order = await Order.findById(id).select({ paidAt: 1 }).lean()
        if (!order) return res.status(404).json({ success: false, message: 'Order not found' })
        if (order.paidAt) await assertFinancialPeriodOpen(order.paidAt)
        const updated = await Order.findByIdAndUpdate(id, { paymentMethod }, { returnDocument: 'after' })

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
