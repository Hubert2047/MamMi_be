import type { Request, Response } from 'express'
import DailyClosing from '../models/daily-closing.js'
import { getFromDayUntilNow, TIME_ZONE } from '../utils/index.js'
import { sendMessageToGroup } from '../services/line.js'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { calculateActualCash, canVoidLatestClosing, isValidCashData, requiresClosingReason } from '../utils/dailyClosingCalculations.js'
import { getDailyClosingSummary as loadDailyClosingSummary } from '../services/dailyClosingSummary.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'

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
        const storeId = (req as AuthRequest).user.storeId
        const summary = await loadDailyClosingSummary(storeId, periodEnd)
        const calculatedSystemAmount = summary.systemAmount
        if (requiresClosingReason(Number(actualTotal) - calculatedSystemAmount, reason)) {
            return res.status(400).json({ success: false, message: 'A reason is required when there is a difference' })
        }

        const dailyClosing = new DailyClosing({
            storeId,
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
        emitStoreEvent(storeId, 'closing.created', { closingId: String(dailyClosing._id), periodStart: dailyClosing.periodStart, periodEnd: dailyClosing.periodEnd })
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
        const summary = await loadDailyClosingSummary((req as AuthRequest).user.storeId)
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

        const storeId = (req as AuthRequest).user.storeId
        const closing = await DailyClosing.findOne({ _id: id, storeId }).lean()
        if (!closing) return res.status(404).json({ success: false, message: 'DailyClosing not found' })
        if (closing.status === 'voided') return res.status(400).json({ success: false, message: 'DailyClosing is already voided' })

        const latest = await DailyClosing.findOne({ storeId, status: { $ne: 'voided' } })
            .sort({ periodEnd: -1, createdAt: -1 })
            .select({ _id: 1 })
            .lean()
        if (!latest || !canVoidLatestClosing(String(closing._id), String(latest._id))) {
            return res.status(409).json({ success: false, message: 'Only the latest confirmed closing can be voided' })
        }

        const result = await DailyClosing.updateOne(
            { _id: id, storeId, status: 'confirmed' },
            { status: 'voided', voidedAt: new Date(), voidedBy: (req as AuthRequest).user.account, voidReason: reason.trim() },
        )
        if (result.modifiedCount !== 1) return res.status(409).json({ success: false, message: 'DailyClosing changed before it was voided' })
        emitStoreEvent(storeId, 'closing.voided', { closingId: id })
        return res.json({ success: true, data: await DailyClosing.findOne({ _id: id, storeId }) })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error voiding DailyClosing', error })
    }
}

export const getDailyClosings = async (req: Request, res: Response) => {
    try {
        const { from, to, status, days } = req.query
        const page = Math.max(1, Number(req.query.page) || 1)
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10))
        const filter: any = { storeId: (req as AuthRequest).user.storeId }
        if (from || to) {
            filter.periodStart = {}
            if (from) filter.periodStart.$gte = fromZonedTime(String(from), TIME_ZONE)
            if (to) filter.periodStart.$lte = fromZonedTime(String(to), TIME_ZONE)
        } else if (days) {
            const daysNumber = Number(days)
            const { start } = getFromDayUntilNow(daysNumber)
            filter.createdAt = { $gte: start }
        }
        if (status === 'confirmed' || status === 'voided') filter.status = status

        const [dailyClosings, total, confirmed, voided, latestConfirmed] = await Promise.all([
            DailyClosing.find(filter).sort({ periodStart: 1, createdAt: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
            DailyClosing.countDocuments(filter),
            DailyClosing.countDocuments({ ...filter, status: 'confirmed' }),
            DailyClosing.countDocuments({ ...filter, status: 'voided' }),
            DailyClosing.findOne({ storeId: filter.storeId, status: 'confirmed' }).sort({ periodEnd: -1, createdAt: -1 }).select({ _id: 1, periodEnd: 1 }).lean(),
        ])
        return res.json({
            success: true,
            data: dailyClosings,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            summary: { total, confirmed, voided, latestConfirmedId: latestConfirmed?._id ?? null, latestConfirmedPeriodEnd: latestConfirmed?.periodEnd ?? null },
        })
    } catch (error) {
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error fetching DailyClosing', error })
    }
}
