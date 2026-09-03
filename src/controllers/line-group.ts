import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import LineGroup from '../models/line-group.js'
import Store from '../models/store.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { Role } from '../constants/role.js'
import { sendMessageToGroup } from '../services/line.js'

const currentStoreId = (req: Request) => (req as AuthRequest).user.storeId

export const listLineGroups = async (req: Request, res: Response) => {
    const user = (req as AuthRequest).user
    const filter = user.role === Role.SuperAdmin ? {} : { storeId: currentStoreId(req) }
    const groups = await LineGroup.find(filter).select({ lineGroupId: 1, storeId: 1, name: 1, usageStatus: 1, createdAt: 1, updatedAt: 1 }).sort({ storeId: 1, createdAt: -1 }).lean()
    res.json({ success: true, data: groups })
}

export const updateLineGroup = async (req: Request, res: Response) => {
    const user = (req as AuthRequest).user
    const id = String(req.params.id)
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ success: false, code: 'LINE_GROUP_PAYLOAD_REQUIRED', message: 'LINE group payload is required' })
    }
    const existing = await LineGroup.findOne(user.role === Role.SuperAdmin ? { _id: id } : { _id: id, storeId: currentStoreId(req) })
    if (!existing) return res.status(404).json({ success: false, message: 'LINE group not found' })
    if (existing.usageStatus === 'assigned') {
        return res.status(409).json({ success: false, code: 'LINE_GROUP_IN_USE', message: 'LINE group must be released before editing' })
    }

    const name = req.body?.name === undefined ? existing.name : String(req.body.name).trim()
    if (!name) return res.status(400).json({ success: false, message: 'Group name is required' })
    const duplicateName = await LineGroup.exists({ name, _id: { $ne: id } })
    if (duplicateName) return res.status(409).json({ success: false, code: 'LINE_GROUP_NAME_EXISTS', message: 'LINE group name already exists' })
    const requestedStoreId = req.body?.storeId !== undefined
        ? (req.body.storeId ? String(req.body.storeId) : null)
        : existing.storeId?.toString() ?? null
    const currentStoreIdValue = existing.storeId?.toString() ?? null
    existing.name = name
    if (req.body?.storeId !== undefined) {
        const storeId = requestedStoreId
        if (storeId && !(await Store.exists({ _id: storeId }))) return res.status(400).json({ success: false, message: 'Store not found' })
        if (storeId) existing.storeId = new mongoose.Types.ObjectId(storeId)
        else existing.set('storeId', null)
    }
    const update: Record<string, unknown> = {
        name: existing.name,
    }
    if (existing.storeId) update.storeId = existing.storeId
    const updated = existing.storeId
        ? await LineGroup.findOneAndUpdate({ _id: id }, { $set: update }, { new: true, runValidators: true }).select({ lineGroupId: 1, storeId: 1, name: 1, usageStatus: 1, createdAt: 1, updatedAt: 1 }).lean()
        : await LineGroup.findOneAndUpdate({ _id: id }, { $set: update, $unset: { storeId: 1 } }, { new: true, runValidators: true }).select({ lineGroupId: 1, storeId: 1, name: 1, usageStatus: 1, createdAt: 1, updatedAt: 1 }).lean()
    if (!updated) return res.status(404).json({ success: false, message: 'LINE group not found' })
    res.json({ success: true, data: updated })
}

export const deleteLineGroup = async (req: Request, res: Response) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid LINE group id' })

    const existing = await LineGroup.findById(id)
    if (existing?.usageStatus === 'assigned') return res.status(409).json({ success: false, code: 'LINE_GROUP_IN_USE', message: 'LINE group must be released before deletion' })
    const group = await LineGroup.findByIdAndDelete(id)
    if (!group) return res.status(404).json({ message: 'LINE group not found' })
    res.json({ success: true })
}

export const testLineGroup = async (req: Request, res: Response) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid LINE group id' })

    const group = await LineGroup.findById(id).select({ lineGroupId: 1 }).lean()
    if (!group) return res.status(404).json({ message: 'LINE group not found' })

    const sent = await sendMessageToGroup(group.lineGroupId, 'Đây là tin nhắn kiểm tra từ MamMi. LINE Group đã kết nối thành công.')
    if (!sent) return res.status(502).json({ message: 'Unable to send LINE test message' })
    res.json({ success: true })
}
