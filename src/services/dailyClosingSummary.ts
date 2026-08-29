import DailyClosing from '../models/daily-closing.js'
import Expense from '../models/expense.js'
import Order from '../models/order.js'
import Revenue from '../models/revenue.js'
import { calculateSystemAmount, getClosingPeriodFilter } from '../utils/dailyClosingCalculations.js'
import Store from '../models/store.js'
import mongoose from 'mongoose'

export type SalesByPaymentSummary = Record<string, { totalSales: number; count: number }>

export type DailyClosingSummary = {
    periodStart: Date
    periodEnd: Date
    salesByPayment: SalesByPaymentSummary
    cashSales: number
    otherRevenueTotal: number
    expensesTotal: number
    previousClosingAmount: number
    systemAmount: number
}

export async function getDailyClosingSummary(storeId: string, end = new Date()): Promise<DailyClosingSummary> {
    const [latestClosing, store] = await Promise.all([
        DailyClosing.findOne({ storeId, status: { $ne: 'voided' } }).sort({ periodEnd: -1, createdAt: -1 }).lean(),
        Store.findById(storeId).select({ createdAt: 1 }).lean(),
    ])
    const firstPeriodStart = store?.createdAt ?? end
    const periodStart = latestClosing?.periodEnd ?? firstPeriodStart
    const periodFilter = getClosingPeriodFilter(latestClosing?.periodEnd, firstPeriodStart, end)
    const mongoStoreId = new mongoose.Types.ObjectId(storeId)
    const [salesResult, otherRevenueResult, expensesResult] = await Promise.all([
        Order.aggregate([
            { $match: { storeId: mongoStoreId, paidAt: periodFilter, status: 'paid' } },
            { $group: { _id: '$paymentMethod', totalSales: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
        ]),
        Revenue.aggregate([
            { $match: { storeId: mongoStoreId, createdAt: periodFilter } },
            { $group: { _id: null, total: { $sum: '$price' } } },
        ]),
        Expense.aggregate([
            { $match: { storeId: mongoStoreId, createdAt: periodFilter } },
            { $group: { _id: null, total: { $sum: '$price' } } },
        ]),
    ])

    const salesByPayment: SalesByPaymentSummary = {}
    salesResult.forEach((sale) => {
        salesByPayment[sale._id] = { totalSales: sale.totalSales, count: sale.count }
    })
    const cashSales = salesByPayment.cash?.totalSales ?? 0
    const otherRevenueTotal = otherRevenueResult[0]?.total ?? 0
    const expensesTotal = expensesResult[0]?.total ?? 0
    const previousClosingAmount = latestClosing?.actualTotal ?? 0

    return {
        periodStart,
        periodEnd: end,
        salesByPayment,
        cashSales,
        otherRevenueTotal,
        expensesTotal,
        previousClosingAmount,
        systemAmount: calculateSystemAmount(previousClosingAmount, cashSales, otherRevenueTotal, expensesTotal),
    }
}
