import type { Request, Response } from 'express'
import DailyClosing from '../models/daily-closing.js'
import { getFromDayUntilNow, TIME_ZONE } from '../utils/index.js'
import { sendMessageToGroup } from '../services/line.js'
import { toZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { calculateActualCash, canVoidLatestClosing, isValidCashData, requiresClosingReason } from '../utils/dailyClosingCalculations.js'
import { getDailyClosingSummary as loadDailyClosingSummary } from '../services/dailyClosingSummary.js'
import type { AuthRequest } from '../middlewares/auth.js'

export const createDailyClosing = async (req: Request, res: Response) => {
    try {
        const { actualTotal, systemAmount, cash, reason } = req.body
        if (!Number.isFinite(Number(actualTotal)) || !Number.isFinite(Number(systemAmount)) || !cash || typeof cash !== 'object') {
            return res.status(400).json({ success: false, message: 'Invalid daily closing amounts or cash data' })
        }
        if (!isValidCashData(cash)) {
            return res.status(400).json({ success: false, message: 'Cash counts must be non-negative integers' })
        }
        const calculatedActualTotal = calculateActualCash(cash)
        if (calculatedActualTotal !== Number(actualTotal)) {
            return res.status(400).json({ success: false, message: 'Actual total does not match cash counts' })
        }

        const periodEnd = new Date()
        const summary = await loadDailyClosingSummary(periodEnd)
        const calculatedSystemAmount = summary.systemAmount
        if (requiresClosingReason(Number(actualTotal) - calculatedSystemAmount, reason)) {
            return res.status(400).json({ success: false, message: 'A reason is required when there is a difference' })
        }

        const dailyClosing = new DailyClosing({
            periodStart: summary.periodStart,
            periodEnd,
            status: 'confirmed',
            actualTotal,
            systemAmount: calculatedSystemAmount,
            cash,
            reason,
            previousClosingAmount: summary.previousClosingAmount,
            cashSales: summary.cashSales,
            otherRevenueTotal: summary.otherRevenueTotal,
            expensesTotal: summary.expensesTotal,
            difference: Number(actualTotal) - calculatedSystemAmount,
            confirmedAt: periodEnd,
            confirmedBy: (req as AuthRequest).user?.account,
        })
        await dailyClosing.save()
        const now = toZonedTime(new Date(), TIME_ZONE)
        const formatted = format(now, 'dd/MM/yyyy HH:mm')
        sendMessageToGroup(
            process.env.DAILY_CLOSING_LINE_GROUP_ID!,
            `Kết toán (${formatted}):\n- Số tiền thực tế: ${actualTotal}\n- Số tiền hệ thống: ${calculatedSystemAmount}\n- Chênh lệch: ${actualTotal - calculatedSystemAmount}\n- Lý do: ${reason}`,
        )
        return res.status(201).json({ success: true, data: dailyClosing })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error creating DailyClosing', error })
    }
}

export const getDailyClosingSummary = async (req: Request, res: Response) => {
    try {
        const summary = await loadDailyClosingSummary()
        return res.json({ success: true, data: summary })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error fetching daily closing summary', error })
    }
}

export const voidDailyClosing = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const { reason } = req.body
        if (typeof reason !== 'string' || !reason.trim()) {
            return res.status(400).json({ success: false, message: 'A reason is required to void a closing' })
        }

        const closing = await DailyClosing.findById(id).lean()
        if (!closing) return res.status(404).json({ success: false, message: 'DailyClosing not found' })
        if (closing.status === 'voided') return res.status(400).json({ success: false, message: 'DailyClosing is already voided' })

        const latest = await DailyClosing.findOne({ status: { $ne: 'voided' } })
            .sort({ periodEnd: -1, createdAt: -1 })
            .select({ _id: 1 })
            .lean()
        if (!latest || !canVoidLatestClosing(String(closing._id), String(latest._id))) {
            return res.status(409).json({ success: false, message: 'Only the latest confirmed closing can be voided' })
        }

        const result = await DailyClosing.updateOne(
            { _id: id, status: 'confirmed' },
            { status: 'voided', voidedAt: new Date(), voidedBy: (req as AuthRequest).user.account, voidReason: reason.trim() },
        )
        if (result.modifiedCount !== 1) return res.status(409).json({ success: false, message: 'DailyClosing changed before it was voided' })
        return res.json({ success: true, data: await DailyClosing.findById(id) })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error voiding DailyClosing', error })
    }
}

export const getDailyClosings = async (req: Request, res: Response) => {
    try {
        const { days } = req.query
        const filter: any = {}
        if (days) {
            const daysNumber = Number(days)
            const { start } = getFromDayUntilNow(daysNumber)
            filter.createdAt = { $gte: start }
        } else {
            filter.status = { $ne: 'voided' }
        }
        const dailyClosings = await DailyClosing.find(filter).sort({ createdAt: -1 }).lean()
        return res.json({ success: true, data: dailyClosings })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error fetching DailyClosing', error })
    }
}
