import type { Request, Response } from 'express'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { endOfDay, startOfDay } from 'date-fns'
import Store from '../models/store.js'
import Order from '../models/order.js'
import Expense from '../models/expense.js'
import Revenue from '../models/revenue.js'
import DailyClosing from '../models/daily-closing.js'
import { TIME_ZONE } from '../utils/index.js'

const parseDateRange = (from: unknown, to: unknown) => {
    const now = toZonedTime(new Date(), TIME_ZONE)
    const isDateOnly = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    const isDateTime = (value: unknown): boolean => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    if ((from !== undefined && !isDateOnly(from) && !isDateTime(from)) || (to !== undefined && !isDateOnly(to) && !isDateTime(to))) return null
    const zonedBoundary = (value: string, endOfMinute: boolean) => isDateOnly(value)
        ? fromZonedTime(`${value} ${endOfMinute ? '23:59:59.999' : '00:00:00'}`, TIME_ZONE)
        : fromZonedTime(`${value.replace('T', ' ')}:${endOfMinute ? '59.999' : '00'}`, TIME_ZONE)
    const start = from !== undefined
        ? zonedBoundary(String(from), false)
        : fromZonedTime(startOfDay(now), TIME_ZONE)
    const end = to !== undefined
        ? zonedBoundary(String(to), true)
        : new Date()
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return null
    return { start, end }
}

export const getSuperAdminOverview = async (req: Request, res: Response) => {
    try {
        const range = parseDateRange(req.query.from, req.query.to)
        if (!range) return res.status(400).json({ success: false, message: 'Invalid overview date range' })
        const stores = await Store.find({ active: true }).select({ code: 1, name: 1 }).sort({ name: 1 }).lean()
        const storeIds = stores.map((store) => store._id)
        const dateFilter = { $gte: range.start, $lte: range.end }
        const [orders, orderPayments, expenses, revenues, closings] = await Promise.all([
            Order.aggregate([{ $match: { storeId: { $in: storeIds }, status: 'paid', paidAt: dateFilter } }, { $group: { _id: '$storeId', revenue: { $sum: '$totalPrice' }, orders: { $sum: 1 } } }]),
            Order.aggregate([{ $match: { storeId: { $in: storeIds }, status: 'paid', paidAt: dateFilter } }, { $group: { _id: { storeId: '$storeId', paymentMethod: '$paymentMethod' }, revenue: { $sum: '$totalPrice' }, orders: { $sum: 1 } } }]),
            Expense.aggregate([{ $match: { storeId: { $in: storeIds }, createdAt: dateFilter } }, { $group: { _id: '$storeId', expenses: { $sum: '$price' }, inventoryExpenses: { $sum: { $cond: [{ $eq: ['$type', 'inventory_purchase'] }, '$price', 0] } }, otherExpenses: { $sum: { $cond: [{ $ne: ['$type', 'inventory_purchase'] }, '$price', 0] } } } }]),
            Revenue.aggregate([{ $match: { storeId: { $in: storeIds }, createdAt: dateFilter } }, { $group: { _id: '$storeId', revenue: { $sum: '$price' } } }]),
            DailyClosing.aggregate([{ $match: { storeId: { $in: storeIds }, status: 'confirmed', confirmedAt: dateFilter } }, { $sort: { confirmedAt: -1 } }, { $group: { _id: '$storeId', closings: { $sum: 1 }, difference: { $sum: '$difference' }, lastClosingAt: { $first: '$confirmedAt' } } }]),
        ])
        const byId = (rows: any[]) => new Map(rows.map((row) => [String(row._id), row]))
        const orderByStore = byId(orders)
        const orderPaymentsByStore = new Map<string, Record<string, number>>()
        orderPayments.forEach((row) => {
            const storeKey = String(row._id.storeId)
            const paymentMethod = String(row._id.paymentMethod || 'other')
            const payments = orderPaymentsByStore.get(storeKey) ?? {}
            payments[paymentMethod] = Number(row.revenue ?? 0)
            orderPaymentsByStore.set(storeKey, payments)
        })
        const expenseByStore = byId(expenses)
        const revenueByStore = byId(revenues)
        const closingByStore = byId(closings)
        const data = stores.map((store) => {
            const order = orderByStore.get(String(store._id)) ?? {}
            const orderRevenueByPayment = orderPaymentsByStore.get(String(store._id)) ?? {}
            const expense = expenseByStore.get(String(store._id)) ?? {}
            const revenue = revenueByStore.get(String(store._id)) ?? {}
            const closing = closingByStore.get(String(store._id)) ?? {}
            const orderRevenue = Number(order.revenue ?? 0)
            const otherRevenue = Number(revenue.revenue ?? 0)
            const sales = orderRevenue + otherRevenue
            const cost = Number(expense.expenses ?? 0)
            return { _id: String(store._id), code: store.code, name: store.name, revenue: sales, orderRevenue, orderRevenueByPayment, otherRevenue, expenses: cost, inventoryExpenses: Number(expense.inventoryExpenses ?? 0), otherExpenses: Number(expense.otherExpenses ?? 0), profit: sales - cost, orders: Number(order.orders ?? 0), closingDifference: Number(closing.difference ?? 0), closingCount: Number(closing.closings ?? 0), lastClosingAt: closing.lastClosingAt ?? null }
        })
        const totals = data.reduce((sum, row) => ({ revenue: sum.revenue + row.revenue, expenses: sum.expenses + row.expenses, profit: sum.profit + row.profit, orders: sum.orders + row.orders, closingDifference: sum.closingDifference + row.closingDifference }), { revenue: 0, expenses: 0, profit: 0, orders: 0, closingDifference: 0 })
        return res.json({ success: true, data: { from: range.start, to: range.end, totals, stores: data } })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error fetching SuperAdmin overview' })
    }
}
