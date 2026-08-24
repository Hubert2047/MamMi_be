import type { Request, Response } from 'express'
import { randomBytes } from 'node:crypto'
import type { AuthRequest } from '../middlewares/auth.js'
import StoreTable from '../models/store-table.js'

export const getStoreTables = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const tables = await StoreTable.find({ storeId }).select({ code: 1, name: 1, active: 1, qrToken: 1 }).sort({ code: 1 }).lean()
        res.json({ success: true, data: tables })
    } catch (error) { res.status(500).json({ success: false, message: 'Unable to fetch tables' }) }
}

export const createStoreTable = async (req: Request, res: Response) => {
    try {
        const code = String(req.body.code || '').trim()
        const name = String(req.body.name || code).trim()
        if (!code || !name) return res.status(400).json({ success: false, message: 'Table code is required' })
        const storeId = (req as AuthRequest).user.storeId
        const table = await StoreTable.create({ storeId, code, name })
        res.status(201).json({ success: true, data: table })
    } catch (error: any) {
        if (error?.code === 11000) return res.status(409).json({ success: false, message: 'This table code already exists' })
        res.status(400).json({ success: false, message: 'Unable to create table' })
    }
}

export const regenerateStoreTableQr = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const table = await StoreTable.findOneAndUpdate(
            { _id: String(req.params.id), storeId },
            { $set: { qrToken: randomBytes(24).toString('base64url') } },
            { new: true, runValidators: true },
        ).lean()
        if (!table) return res.status(404).json({ success: false, message: 'Table not found' })
        res.json({ success: true, data: table })
    } catch (error) { res.status(400).json({ success: false, message: 'Unable to regenerate QR code' }) }
}

export const regenerateAllStoreTableQr = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const tables = await StoreTable.find({ storeId }).select({ _id: 1 }).lean()
        if (tables.length > 0) {
            await StoreTable.bulkWrite(tables.map((table) => ({ updateOne: { filter: { _id: table._id }, update: { $set: { qrToken: randomBytes(24).toString('base64url') } } } })))
        }
        res.json({ success: true, data: { count: tables.length } })
    } catch (error) { res.status(400).json({ success: false, message: 'Unable to regenerate QR codes' }) }
}
