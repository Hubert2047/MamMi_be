import DailyClosing from '../models/daily-closing.js'
import Expense from '../models/expense.js'
import Order from '../models/order.js'
import Revenue from '../models/revenue.js'
import { getFullDay } from '../utils/index.js'
import { calculateSystemAmount } from '../utils/dailyClosingCalculations.js'
import { buildPaidOrderFilter } from '../utils/paidOrderFilters.js'

export type SalesByPaymentSummary = Record<string, { totalSales: number; count: number }>

export type DailyClosingSummary = {
    salesByPayment: SalesByPaymentSummary
    cashSales: number
    otherRevenueTotal: number
    expensesTotal: number
    previousClosingAmount: number
    systemAmount: number
}

export async function getDailyClosingSummary(): Promise<DailyClosingSummary> {
    const { start, end } = getFullDay(0)
    const { start: previousStart, end: previousEnd } = getFullDay(1)
    const [salesResult, previousClosing, otherRevenueResult, expensesResult] = await Promise.all([
        Order.aggregate([
            { $match: buildPaidOrderFilter(start, end) },
            { $group: { _id: '$paymentMethod', totalSales: { $sum: '$totalPrice' }, count: { $sum: 1 } } },
        ]),
        DailyClosing.findOne({ createdAt: { $gte: previousStart, $lte: previousEnd } }).sort({ createdAt: -1 }).lean(),
        Revenue.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
            { $group: { _id: null, total: { $sum: '$price' } } },
        ]),
        Expense.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
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
    const previousClosingAmount = previousClosing?.actualTotal ?? 0

    return {
        salesByPayment,
        cashSales,
        otherRevenueTotal,
        expensesTotal,
        previousClosingAmount,
        systemAmount: calculateSystemAmount(previousClosingAmount, cashSales, otherRevenueTotal, expensesTotal),
    }
}
