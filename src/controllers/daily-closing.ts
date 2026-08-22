import type { Request, Response } from 'express'
import DailyClosing from '../models/daily-closing.js'
import { getFromDayUntilNow, getFullDay, TIME_ZONE } from '../utils/index.js'
import { sendMessageToGroup } from '../services/line.js'
import { toZonedTime, fromZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { calculateActualCash, isValidCashData, requiresClosingReason } from '../utils/dailyClosingCalculations.js'
import { getDailyClosingSummary as loadDailyClosingSummary } from '../services/dailyClosingSummary.js'
export const createDailyClosing = async (req: Request, res: Response) => {
    try {
        const { actualTotal, systemAmount, cash, reason } = req.body
        const { start, end } = getFullDay(0)
        const closingDay = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())

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

        const summary = await loadDailyClosingSummary()
        const calculatedSystemAmount = summary.systemAmount
        if (requiresClosingReason(Number(actualTotal) - calculatedSystemAmount, reason)) {
            return res.status(400).json({ success: false, message: 'A reason is required when there is a difference' })
        }

        const existing = await DailyClosing.findOne({
            $or: [
                { closingDay },
                { createdAt: { $gte: start, $lte: end } },
            ],
        }).lean()
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Today already has a DailyClosing record',
            })
        }

        const dailyClosing = new DailyClosing({
            actualTotal,
            systemAmount: calculatedSystemAmount,
            cash,
            reason,
            closingDay,
            createdAt: new Date(), // optional, Mongo tự set createdAt
        })
        await dailyClosing.save()
        const now = toZonedTime(new Date(), TIME_ZONE)
        const formatted = format(now, 'dd/MM/yyyy HH:mm')
        sendMessageToGroup(
            process.env.DAILY_CLOSING_LINE_GROUP_ID!,
            `Kết toán hôm nay (${formatted}):\n- Số tiền thực tế: ${actualTotal}\n- Số tiền hệ thống: ${calculatedSystemAmount}\n- Chênh lệch: ${actualTotal - calculatedSystemAmount}\n- Lý do: ${reason}`,
        )
        res.status(201).json({
            success: true,
            data: dailyClosing,
        })
    } catch (error) {
        console.error(error)
        res.status(500).json({
            success: false,
            message: 'Error creating DailyClosing',
            error,
        })
    }
}
export const getDailyClosingSummary = async (req: Request, res: Response) => {
    try {
        const summary = await loadDailyClosingSummary()
        res.json({ success: true, data: summary })
    } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Today already has a DailyClosing record' })
        }
        console.error(error)
        res.status(500).json({ success: false, message: 'Error fetching daily closing summary', error })
    }
}
export const getClosingOfYesterday = async (req: Request, res: Response) => {
    try {
        const { start, end } = getFullDay(1)
        const closing = await DailyClosing.findOne({
            createdAt: { $gte: start, $lte: end },
        })

        res.json({
            success: true,
            data: { amount: closing ? closing.actualTotal : 0 },
        })
    } catch (error) {
        console.error(error)
        res.status(500).json({
            success: false,
            message: 'Error fetching yesterday closing',
            error,
        })
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
            const { start, end } = getFromDayUntilNow(0)
            filter.createdAt = { $gte: start, $lte: end }
        }
        const dailyClosings = await DailyClosing.find(filter).sort({ createdAt: -1 })

        res.json({ success: true, data: dailyClosings })
    } catch (error) {
        console.error(error)
        res.status(500).json({ success: false, message: 'Error fetching DailyClosing', error })
    }
}
export const deleteDailyClosing = async (req: Request, res: Response) => {
    try {
        const { id } = req.params

        const dailyClosing = await DailyClosing.findByIdAndDelete(id)

        if (!dailyClosing) {
            return res.status(404).json({
                success: false,
                message: 'DailyClosing not found',
            })
        }

        res.json({
            success: true,
            message: 'DailyClosing deleted successfully',
            data: dailyClosing,
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error deleting DailyClosing',
            error,
        })
    }
}

export const updateDailyClosing = async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const data = req.body
        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu id',
            })
        }

        const updated = await DailyClosing.findByIdAndUpdate(
            id,
            {
                ...data,
                price: Number(data.price),
            },
            {
                runValidators: true,
                returnDocument: 'after',
            },
        )

        if (!updated) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy DailyClosing',
            })
        }

        return res.json({
            success: true,
            data: updated,
        })
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: 'Error updating DailyClosing',
            error,
        })
    }
}
