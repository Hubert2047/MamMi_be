import bcrypt from 'bcrypt'
import type { Request, Response } from 'express'
import mongoose from 'mongoose'
import User from '../models/user.js'
import Store from '../models/store.js'
import { Role } from '../middlewares/auth.js'

const managedRoles = [Role.Admin, Role.Employee]

function invalidAccount(account: unknown) {
    return typeof account !== 'string' || !/^[a-zA-Z0-9._-]{3,50}$/.test(account.trim())
}

export const listManagedUsers = async (_req: Request, res: Response) => {
    try {
        const users = await User.find({ role: { $in: [...managedRoles, Role.SuperAdmin] } })
            .select({ password: 0 })
            .populate('storeIds', 'name code')
            .sort({ account: 1 })
            .lean()
        users.sort((left, right) => Number(right.role === Role.SuperAdmin) - Number(left.role === Role.SuperAdmin) || left.account.localeCompare(right.account))
        return res.json({ error: false, data: users.map((user) => ({ ...user, active: user.active !== false })) })
    } catch (error: any) {
        return res.status(500).json({ error: true, message: error.message })
    }
}

export const createManagedUser = async (req: Request, res: Response) => {
    try {
        const { account, password, role, storeId } = req.body
        const normalizedAccount = typeof account === 'string' ? account.trim() : ''
        if (invalidAccount(normalizedAccount)) return res.status(400).json({ error: true, message: 'Account must be 3-50 characters and use only letters, numbers, dot, underscore or hyphen' })
        if (typeof password !== 'string' || password.length < 6) return res.status(400).json({ error: true, message: 'Password must be at least 6 characters' })
        if (!managedRoles.includes(role)) return res.status(400).json({ error: true, message: 'Only Admin or Employee accounts can be created here' })
        if (!mongoose.isValidObjectId(storeId)) return res.status(400).json({ error: true, message: 'A valid store is required' })
        const store = await Store.findOne({ _id: storeId, active: true }).select({ _id: 1 }).lean()
        if (!store) return res.status(400).json({ error: true, message: 'Store is not available' })
        if (await User.exists({ account: normalizedAccount })) return res.status(409).json({ error: true, message: 'Account already exists' })
        const passwordHash = await bcrypt.hash(password, Number(process.env.SALT) || 10)
        const user = await User.create({ account: normalizedAccount, password: passwordHash, role, active: true, storeIds: [storeId], defaultStoreId: storeId })
        return res.status(201).json({ error: false, data: { _id: user._id, account: user.account, role: user.role, active: user.active, storeIds: [storeId], defaultStoreId: storeId } })
    } catch (error: any) {
        return res.status(500).json({ error: true, message: error.message })
    }
}

export const updateManagedUser = async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const { account, password, role, storeId, active } = req.body
        if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: true, message: 'Invalid user id' })
        const normalizedAccount = account === undefined ? undefined : typeof account === 'string' ? account.trim() : ''
        if (normalizedAccount !== undefined && invalidAccount(normalizedAccount)) return res.status(400).json({ error: true, message: 'Account must be 3-50 characters and use only letters, numbers, dot, underscore or hyphen' })
        if (role !== undefined && !managedRoles.includes(role)) return res.status(400).json({ error: true, message: 'Only Admin or Employee roles are allowed' })
        if (storeId !== undefined && !mongoose.isValidObjectId(storeId)) return res.status(400).json({ error: true, message: 'A valid store is required' })
        if (storeId !== undefined && !(await Store.exists({ _id: storeId, active: true }))) return res.status(400).json({ error: true, message: 'Store is not available' })
        if (password !== undefined && (typeof password !== 'string' || password.length < 6)) return res.status(400).json({ error: true, message: 'Password must be at least 6 characters' })
        const user = await User.findOne({ _id: id, role: { $in: [...managedRoles, Role.SuperAdmin] } })
        if (!user) return res.status(404).json({ error: true, message: 'User not found' })
        if (user.role === Role.SuperAdmin && (normalizedAccount !== undefined || role !== undefined || storeId !== undefined || active !== undefined)) return res.status(400).json({ error: true, message: 'The SuperAdmin account can only change its password' })
        if (normalizedAccount !== undefined && normalizedAccount !== user.account && await User.exists({ account: normalizedAccount, _id: { $ne: id } })) return res.status(409).json({ error: true, message: 'Account already exists' })
        if (normalizedAccount !== undefined) user.account = normalizedAccount
        if (role !== undefined) user.role = role
        if (storeId !== undefined) { user.storeIds = [storeId]; user.defaultStoreId = storeId }
        if (active !== undefined) user.active = Boolean(active)
        if (password !== undefined) user.password = await bcrypt.hash(password, Number(process.env.SALT) || 10)
        await user.save()
        return res.json({ error: false, data: { _id: user._id, account: user.account, role: user.role, active: user.active, storeIds: user.storeIds, defaultStoreId: user.defaultStoreId } })
    } catch (error: any) {
        return res.status(500).json({ error: true, message: error.message })
    }
}
