import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import LineGroup, { lineNotificationTypes, type LineNotificationType } from '../models/line-group.js'
import Store from '../models/store.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { Role } from '../constants/role.js'
import { sendMessageToGroup } from '../services/line.js'

const currentStoreId = (req: Request) => (req as AuthRequest).user.storeId

export const listLineGroups = async (req: Request, res: Response) => {
    const user = (req as AuthRequest).user
    const filter = user.role === Role.SuperAdmin ? {} : { storeId: currentStoreId(req) }
    const groups = await LineGroup.find(filter).sort({ status: 1, createdAt: -1 }).lean()
    res.json({ success: true, data: groups })
}

export const updateLineGroup = async (req: Request, res: Response) => {
    const user = (req as AuthRequest).user
    const id = String(req.params.id)
    const existing = await LineGroup.findOne(user.role === Role.SuperAdmin ? { _id: id } : { _id: id, storeId: currentStoreId(req) })
    if (!existing) return res.status(404).json({ success: false, message: 'LINE group not found' })

    const name = req.body?.name === undefined ? existing.name : String(req.body.name).trim()
    if (!name) return res.status(400).json({ success: false, message: 'Group name is required' })
    const notificationTypes = req.body?.notificationTypes === undefined
        ? existing.notificationTypes
        : Array.isArray(req.body.notificationTypes)
            ? req.body.notificationTypes.filter((type: unknown): type is LineNotificationType => typeof type === 'string' && lineNotificationTypes.includes(type as LineNotificationType))
            : null
    if (!notificationTypes) return res.status(400).json({ success: false, message: 'Invalid notification types' })

    existing.name = name
    existing.notificationTypes = notificationTypes
    if (req.body?.enabled !== undefined) existing.enabled = Boolean(req.body.enabled)
    if (user.role === Role.SuperAdmin && req.body?.storeId !== undefined) {
        const storeId = req.body.storeId ? String(req.body.storeId) : null
        if (storeId && !(await Store.exists({ _id: storeId }))) return res.status(400).json({ success: false, message: 'Store not found' })
        if (storeId) existing.storeId = new mongoose.Types.ObjectId(storeId)
        else existing.set('storeId', null)
    }
    if (existing.enabled && existing.storeId && existing.notificationTypes.length) existing.status = 'active'
    else if (!existing.enabled) existing.status = 'disabled'
    else existing.status = 'pending'
    await existing.save()
    res.json({ success: true, data: existing })
}

export const deleteLineGroup = async (req: Request, res: Response) => {
    const id = String(req.params.id)
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ message: 'Invalid LINE group id' })

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
