import type { Request, Response } from 'express'
import Expense from '../models/expense.js'
import InventoryReceipt from '../models/inventory-receipt.js'
import DailyClosing from '../models/daily-closing.js'
import Store from '../models/store.js'
import { getFromDayUntilNow } from '../utils/index.js'
import { assertFinancialPeriodOpen, FinancialPeriodClosedError } from '../services/financialPeriodLock.js'
import type { AuthRequest } from '../middlewares/auth.js'
export const createExpense = async (req: Request, res: Response) => {
    try {
        const { name, quantity = 1, unit = '', unitPrice, price, note, category = 'other' } = req.body
        const normalizedQuantity = Number(quantity)
        const normalizedUnitPrice = Number(unitPrice ?? price)
        if (!name || !Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0 || !Number.isFinite(normalizedUnitPrice) || normalizedUnitPrice < 0) {
            return res.status(400).json({ success: false, message: 'Invalid expense quantity or price' })
        }
        const expense = new Expense({ storeId: (req as AuthRequest).user.storeId, name, quantity: normalizedQuantity, unit, unitPrice: normalizedUnitPrice, price: normalizedQuantity * normalizedUnitPrice, note, category, type: 'other' })
        await expense.save()
        res.status(201).json({ success: true, data: expense })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error creating expense', error })
    }
}

export const getExpenses = async (req: Request, res: Response) => {
    try {
        const { days, from, to } = req.query
        const storeId = (req as AuthRequest).user.storeId
        const filter: any = { storeId }
        if (from || to) {
            const fromDate = from ? new Date(String(from)) : undefined
            const toDate = to ? new Date(String(to)) : new Date()
            if ((fromDate && Number.isNaN(fromDate.getTime())) || Number.isNaN(toDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid expense date range' })
            filter.createdAt = { ...(fromDate ? { $gte: fromDate } : {}), $lte: toDate }
        } else if (days) {
            const daysNumber = Number(days)
            const { start } = getFromDayUntilNow(daysNumber)
            filter.createdAt = { $gte: start }
        } else {
            const [latestClosing, store] = await Promise.all([
                DailyClosing.findOne({ storeId, status: { $ne: 'voided' } }).sort({ periodEnd: -1, createdAt: -1 }).select({ periodEnd: 1 }).lean(),
                Store.findById(storeId).select({ createdAt: 1 }).lean(),
            ])
            filter.createdAt = latestClosing
                ? { $gt: latestClosing.periodEnd, $lte: new Date() }
                : { $gte: store?.createdAt ?? getFromDayUntilNow(0).start, $lte: new Date() }
        }
        const expenses = await Expense.find(filter).sort({ createdAt: -1 }).lean()
        const inventoryExpenseIds = expenses.filter((expense) => expense.type === 'inventory_purchase').map((expense) => expense._id)
        const receipts = await InventoryReceipt.find({ storeId, expenseId: { $in: inventoryExpenseIds } }).populate('lines.inventoryItemId', 'name').lean()
        const receiptNames = new Map(receipts.map((receipt: any) => [String(receipt.expenseId), [...new Set(receipt.lines.map((line: any) => line.inventoryItemId?.name).filter(Boolean))].join(', ')]))
        const result = expenses.map((expense) => ({ ...expense, name: receiptNames.get(String(expense._id)) || expense.name }))
        res.json({ success: true, data: result })
    } catch (error) {
        console.error(error)
        res.status(500).json({ success: false, message: 'Error fetching expenses', error })
    }
}
export const deleteExpense = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const storeId = (req as AuthRequest).user.storeId
        const expense = await Expense.findOne({ _id: id, storeId }).select({ createdAt: 1, quantity: 1, unitPrice: 1, price: 1 }).lean()
        if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' })
        await assertFinancialPeriodOpen(storeId, expense.createdAt)

        const deletedExpense = await Expense.findOneAndDelete({ _id: id, storeId })

        if (!deletedExpense) {
            return res.status(404).json({
                success: false,
                message: 'Expense not found',
            })
        }

        res.json({
            success: true,
            message: 'Expense deleted successfully',
            data: deletedExpense,
        })
    } catch (error) {
        if (error instanceof FinancialPeriodClosedError) {
            return res.status(error.statusCode).json({ success: false, message: error.message })
        }
        res.status(500).json({
            success: false,
            message: 'Error deleting expense',
            error,
        })
    }
}

export const updateExpense = async (req: Request, res: Response) => {
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
        const expense = await Expense.findOne({ _id: id, storeId }).select({ createdAt: 1, quantity: 1, unitPrice: 1, price: 1 }).lean()
        if (!expense) return res.status(404).json({ success: false, message: 'Expense not found' })
        await assertFinancialPeriodOpen(storeId, expense.createdAt)

        const normalizedQuantity = Number(data.quantity ?? expense.quantity ?? 1)
        const normalizedUnitPrice = Number(data.unitPrice ?? data.price ?? expense.unitPrice ?? expense.price)
        if (!Number.isFinite(normalizedQuantity) || normalizedQuantity <= 0 || !Number.isFinite(normalizedUnitPrice) || normalizedUnitPrice < 0) {
            return res.status(400).json({ success: false, message: 'Invalid expense quantity or price' })
        }
        const updated = await Expense.findOneAndUpdate(
            { _id: id, storeId },
            {
                ...data,
                quantity: normalizedQuantity,
                unit: data.unit ?? '',
                unitPrice: normalizedUnitPrice,
                price: normalizedQuantity * normalizedUnitPrice,
            },
            {
                returnDocument: 'after',
                runValidators: true,
            },
        )

        if (!updated) {
            return res.status(404).json({
                success: false,
                message: 'Không tìm thấy expense',
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
            message: 'Error updating expense',
            error,
        })
    }
}
