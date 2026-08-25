import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { Request, Response } from 'express'
import PosDevice from '../models/pos-device.js'
import type { AuthRequest } from '../middlewares/auth.js'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const enrollmentCode = () => randomInt(100000, 1000000).toString()
const deviceToken = () => randomBytes(32).toString('base64url')
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, maxAge: 1000 * 60 * 60 * 24 * 365 }

function cleanExpiredEnrollment(device: any) {
    return device.pendingEnrollmentExpiresAt && device.pendingEnrollmentExpiresAt.getTime() <= Date.now()
}

async function createEnrollment(device: any) {
    const code = enrollmentCode()
    device.pendingEnrollmentHash = hash(code)
    device.pendingEnrollmentExpiresAt = new Date(Date.now() + 10 * 60 * 1000)
    await device.save()
    return { code, expiresAt: device.pendingEnrollmentExpiresAt }
}

export const listPosDevices = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const devices = await PosDevice.find({ storeId }).sort({ name: 1 })
    await Promise.all(devices.filter(cleanExpiredEnrollment).map((device) => PosDevice.updateOne({ _id: device._id }, { $unset: { pendingEnrollmentHash: 1, pendingEnrollmentExpiresAt: 1 } })))
    res.json({ success: true, data: devices.map((device) => ({ _id: device._id, name: device.name, role: device.role, active: device.active, enrolledAt: device.enrolledAt, lastSeenAt: device.lastSeenAt, hasPendingEnrollment: Boolean(device.pendingEnrollmentHash && !cleanExpiredEnrollment(device)), pendingEnrollmentExpiresAt: cleanExpiredEnrollment(device) ? undefined : device.pendingEnrollmentExpiresAt })) })
}

export const createPosDevice = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const name = String(req.body.name || '').trim()
        if (!name) return res.status(400).json({ success: false, message: 'Device name is required' })
        const device = await PosDevice.create({ storeId, name, role: 'Employee' })
        const enrollment = await createEnrollment(device)
        res.status(201).json({ success: true, data: { device: { _id: device._id, name: device.name, role: device.role, active: device.active }, enrollment } })
    } catch (error: any) {
        res.status(error?.code === 11000 ? 409 : 400).json({ success: false, message: error?.code === 11000 ? 'Device name already exists' : 'Unable to create POS device' })
    }
}

export const generateEnrollment = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const device = await PosDevice.findOne({ _id: String(req.params.id), storeId })
    if (!device) return res.status(404).json({ success: false, message: 'POS device not found' })
    const enrollment = await createEnrollment(device)
    res.json({ success: true, data: enrollment })
}

export const deleteEnrollment = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const result = await PosDevice.updateOne({ _id: String(req.params.id), storeId }, { $unset: { pendingEnrollmentHash: 1, pendingEnrollmentExpiresAt: 1 } })
    if (!result.matchedCount) return res.status(404).json({ success: false, message: 'POS device not found' })
    res.json({ success: true })
}

export const reenrollPosDevice = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const device = await PosDevice.findOne({ _id: String(req.params.id), storeId })
    if (!device) return res.status(404).json({ success: false, message: 'POS device not found' })
    device.deviceTokenHash = undefined
    device.enrolledAt = undefined
    device.revokedAt = new Date()
    const enrollment = await createEnrollment(device)
    res.json({ success: true, data: enrollment })
}

export const updatePosDevice = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const update: Record<string, unknown> = {}
    if (typeof req.body.name === 'string') {
        const name = req.body.name.trim()
        if (!name) return res.status(400).json({ success: false, message: 'Device name is required' })
        update.name = name
    }
    const hasActiveChange = typeof req.body.active === 'boolean'
    if (hasActiveChange) update.active = req.body.active
    if (!Object.keys(update).length) return res.status(400).json({ success: false, message: 'No device changes provided' })
    if (req.body.active === false) update.revokedAt = new Date()
    try {
        const device = await PosDevice.findOneAndUpdate({ _id: String(req.params.id), storeId }, { $set: update, ...(req.body.active === false ? { $unset: { deviceTokenHash: 1, pendingEnrollmentHash: 1, pendingEnrollmentExpiresAt: 1 } } : {}) }, { new: true, runValidators: true })
        if (!device) return res.status(404).json({ success: false, message: 'POS device not found' })
        res.json({ success: true, data: device })
    } catch (error: any) {
        res.status(error?.code === 11000 ? 409 : 400).json({ success: false, message: error?.code === 11000 ? 'Device name already exists' : 'Unable to update POS device' })
    }
}

export const deletePosDevice = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const result = await PosDevice.deleteOne({ _id: String(req.params.id), storeId })
    if (!result.deletedCount) return res.status(404).json({ success: false, message: 'POS device not found' })
    res.json({ success: true })
}

export const enrollPosDevice = async (req: Request, res: Response) => {
    const code = typeof req.body.code === 'string' ? req.body.code.trim() : ''
    if (!code) return res.status(400).json({ success: false, message: 'Enrollment code is required' })
    const device = await PosDevice.findOne({ pendingEnrollmentHash: hash(code), active: true })
    if (!device || !device.pendingEnrollmentExpiresAt || device.pendingEnrollmentExpiresAt.getTime() <= Date.now()) {
        if (device) await PosDevice.updateOne({ _id: device._id }, { $unset: { pendingEnrollmentHash: 1, pendingEnrollmentExpiresAt: 1 } })
        return res.status(401).json({ success: false, message: 'Enrollment code is invalid or expired' })
    }
    const token = deviceToken()
    device.deviceTokenHash = hash(token)
    device.enrolledAt = new Date()
    device.lastSeenAt = new Date()
    device.pendingEnrollmentHash = undefined
    device.pendingEnrollmentExpiresAt = undefined
    device.revokedAt = undefined
    await device.save()
    res.cookie('pos_device_session', token, cookieOptions)
    res.json({ success: true, data: { name: device.name, role: device.role, storeId: String(device.storeId) } })
}

export const getPosDeviceSession = async (req: Request, res: Response) => {
    const token = req.cookies?.pos_device_session
    if (!token) return res.sendStatus(401)
    const device = await PosDevice.findOne({ deviceTokenHash: hash(token), active: true }).lean()
    if (!device) return res.sendStatus(401)
    await PosDevice.updateOne({ _id: device._id }, { $set: { lastSeenAt: new Date() } })
    res.json({ success: true, data: { name: device.name, role: device.role, storeId: String(device.storeId) } })
}
