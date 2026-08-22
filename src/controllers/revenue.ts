import type { Request, Response } from 'express'
import Revenue from '../models/revenue.js'
import { getFromDayUntilNow } from '../utils/index.js'
import { assertFinancialPeriodOpen, FinancialPeriodClosedError } from '../services/financialPeriodLock.js'
import type { AuthRequest } from '../middlewares/auth.js'
export const createRevenue = async (req: Request, res: Response) => {
    try {
        const { name, price, note } = req.body
        const revenue = new Revenue({ storeId: (req as AuthRequest).user.storeId, name, price, note })
        await revenue.save()
        res.status(201).json({ success: true, data: revenue })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating Revenue', error })
    }
}

export const getRevenues = async (req: Request, res: Response) => {
    try {
        const { days } = req.query
        const storeId = (req as AuthRequest).user.storeId
        const filter: any = { storeId }
        if (days) {
            const daysNumber = Number(days)
            const { start } = getFromDayUntilNow(daysNumber)
            filter.createdAt = { $gte: start }
        } else {
            const { start, end } = getFromDayUntilNow(0)
            filter.createdAt = { $gte: start, $lte: end }
        }
        const revenues = await Revenue.find(filter).sort({ createdAt: -1 })
        res.json({ success: true, data: revenues })
    } catch (error) {
        console.error(error)
        res.status(500).json({ success: false, message: 'Error fetching Revenue', error })
    }
}
export const deleteRevenue = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const storeId = (req as AuthRequest).user.storeId
        const revenue = await Revenue.findOne({ _id: id, storeId }).select({ createdAt: 1 }).lean()
        if (!revenue) return res.status(404).json({ success: false, message: 'Revenue not found' })
        await assertFinancialPeriodOpen(storeId, revenue.createdAt)

        const deletedRevenue = await Revenue.findOneAndDelete({ _id: id, storeId })

        if (!deletedRevenue) {
            return res.status(404).json({
                success: false,
                message: 'Revenue not found',
            })
        }

        res.json({
            success: true,
            message: 'Revenue deleted successfully',
            data: deletedRevenue,
        })
    } catch (error) {
        if (error instanceof FinancialPeriodClosedError) {
            return res.status(error.statusCode).json({ success: false, message: error.message })
        }
        res.status(500).json({
            success: false,
            message: 'Error deleting Revenue',
            error,
        })
    }
}

export const updateRevenue = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const storeId = (req as AuthRequest).user.storeId
        const data = req.body
        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu id',
            })
        }
        const revenue = await Revenue.findOne({ _id: id, storeId }).select({ createdAt: 1 }).lean()
        if (!revenue) return res.status(404).json({ success: false, message: 'Revenue not found' })
        await assertFinancialPeriodOpen(storeId, revenue.createdAt)

        const updated = await Revenue.findOneAndUpdate(
            { _id: id, storeId },
            {
                ...data,
                price: Number(data.price),
            },
            {
                returnDocument: 'after',
                runValidators: true,
            },
        )

        if (!updated) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy Revenue',
            })
        }

        return res.json({
            success: true,
            data: updated,
        })
    } catch (error) {
        if (error instanceof FinancialPeriodClosedError) {
            return res.status(error.statusCode).json({ success: false, message: error.message })
        }
        return res.status(500).json({
            success: false,
            message: 'Error updating Revenue',
            error,
        })
    }
}
