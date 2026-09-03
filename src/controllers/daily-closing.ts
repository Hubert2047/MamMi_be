import type { Request, Response } from 'express'
import DailyClosing from '../models/daily-closing.js'
import Employee from '../models/employee.js'
import { getFromDayUntilNow, TIME_ZONE } from '../utils/index.js'
import { sendMessageToConfiguredGroups } from '../services/line.js'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { format } from 'date-fns'
import { calculateActualCash, canVoidLatestClosing, isValidCashData, requiresClosingReason } from '../utils/dailyClosingCalculations.js'
import { getDailyClosingSummary as loadDailyClosingSummary } from '../services/dailyClosingSummary.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitStoreEvent } from '../realtime.js'
import { enqueueClosingBackup } from '../services/backupJobs.js'
import mongoose from 'mongoose'
import LineGroup from '../models/line-group.js'
import StoreLineGroupConfig from '../models/store-line-group-config.js'

const dailyClosingLineGroupData = async (storeId: string) => {
    const config = await StoreLineGroupConfig.findOne({ storeId }).populate({ path: 'dailyClosingLineGroupId', select: 'lineGroupId name storeId usageStatus' }).lean()
    const currentId = config?.dailyClosingLineGroupId?._id
    const groups = await LineGroup.find({ storeId, $or: [{ usageStatus: 'available' }, ...(currentId ? [{ _id: currentId }] : [])] }).select({ lineGroupId: 1, name: 1, usageStatus: 1 }).sort({ name: 1 }).lean()
    return { enabled: Boolean(currentId), lineGroupId: currentId?.toString() ?? null, groups }
}

export const getDailyClosingLineGroup = async (req: Request, res: Response) => {
    try { return res.json({ success: true, data: await dailyClosingLineGroupData((req as AuthRequest).user.storeId) }) }
    catch (error) { console.error(error); return res.status(500).json({ success: false, message: 'Error fetching daily closing LINE group configuration' }) }
}

export const updateDailyClosingLineGroup = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    let claimedId: mongoose.Types.ObjectId | null = null
    try {
        const enabled = req.body?.enabled === true
        const requestedId = enabled && req.body?.lineGroupId ? String(req.body.lineGroupId) : null
        if (enabled && !requestedId) return res.status(400).json({ success: false, code: 'DAILY_CLOSING_LINE_GROUP_REQUIRED', message: 'A LINE group is required when notifications are enabled' })
        const current = await StoreLineGroupConfig.findOne({ storeId }).lean()
        const previousId = current?.dailyClosingLineGroupId
        if (requestedId && !mongoose.isValidObjectId(requestedId)) return res.status(400).json({ success: false, code: 'INVALID_LINE_GROUP', message: 'Invalid LINE group' })
        if (requestedId && String(previousId ?? '') !== requestedId) {
            const result = await LineGroup.updateOne({ _id: requestedId, storeId, usageStatus: 'available' }, { $set: { usageStatus: 'assigned' } })
            if (result.modifiedCount !== 1) return res.status(409).json({ success: false, code: 'LINE_GROUP_IN_USE', message: 'LINE group is unavailable' })
            claimedId = new mongoose.Types.ObjectId(requestedId)
        }
        if (requestedId) await StoreLineGroupConfig.findOneAndUpdate({ storeId }, { $set: { dailyClosingLineGroupId: new mongoose.Types.ObjectId(requestedId) } }, { upsert: true })
        else await StoreLineGroupConfig.updateOne({ storeId }, { $unset: { dailyClosingLineGroupId: 1 } })
        if (previousId && String(previousId) !== requestedId) await LineGroup.updateOne({ _id: previousId }, { $set: { usageStatus: 'available' } })
        return res.json({ success: true, data: await dailyClosingLineGroupData(storeId) })
    } catch (error) {
        if (claimedId) await LineGroup.updateOne({ _id: claimedId }, { $set: { usageStatus: 'available' } })
        console.error(error)
        return res.status(500).json({ success: false, message: 'Error updating daily closing LINE group configuration' })
    }
}

export const createDailyClosing = async (req: Request, res: Response) => {
    try {
        const { actualTotal, systemAmount, cash, reason, employeeNumberId } = req.body
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
        if (typeof employeeNumberId !== 'string' || !employeeNumberId.trim()) {
            return res.status(400).json({ success: false, code: 'EMPLOYEE_NUMBER_ID_REQUIRED', message: 'Employee number ID is required' })
        }
        const employee = await Employee.findOne({ numberId: employeeNumberId.trim(), storeId }).select({ _id: 1, numberId: 1, name: 1, active: 1 }).lean()
        if (!employee) {
            return res.status(400).json({ success: false, code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found' })
        }
        if (employee.active === false) {
            return res.status(403).json({ success: false, code: 'EMPLOYEE_INACTIVE', message: 'Employee is inactive' })
        }
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
            confirmedByEmployee: {
                employeeId: employee._id,
                numberId: employee.numberId,
                name: employee.name,
            },
        })
        await dailyClosing.save()
        try {
            await enqueueClosingBackup(dailyClosing._id, dailyClosing.storeId)
        } catch (backupJobError) {
            // Cloud backup is asynchronous and must never prevent a completed closing.
            console.error('Unable to enqueue closing backup', backupJobError)
        }
        emitStoreEvent(storeId, 'closing.created', { closingId: String(dailyClosing._id), periodStart: dailyClosing.periodStart, periodEnd: dailyClosing.periodEnd })
        const now = toZonedTime(new Date(), TIME_ZONE)
        const formatted = format(now, 'dd/MM/yyyy HH:mm')
        void sendMessageToConfiguredGroups(
            storeId,
            `Kết toán (${formatted}):\n- Số tiền thực tế: ${actualTotal}\n- Số tiền hệ thống: ${calculatedSystemAmount}\n- Chênh lệch: ${actualTotal - calculatedSystemAmount}\n- Lý do: ${reason}`,
        ).catch((error) => console.error('Unable to send LINE closing notification', error))
        return res.status(201).json({ success: true, data: dailyClosing })
    } catch (error) {
        if ((error as { code?: number })?.code === 11000) {
            return res.status(409).json({ success: false, code: 'CLOSING_ALREADY_CREATED', message: 'This closing period was already confirmed by another device' })
        }
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
