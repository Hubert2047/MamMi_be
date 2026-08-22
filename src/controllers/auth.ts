import bcrypt from 'bcrypt'
import type { Request, Response, NextFunction } from 'express'
import { Role, type AuthRequest } from '../middlewares/auth.js'
import User from '../models/user.js'
import { customError, generateTokens } from '../utils/index.js'
import UserToken from '../models/user-token.js'
import Store from '../models/store.js'
import mongoose from 'mongoose'
export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { account, password, storeId } = req.body
        if (!account || !password) {
            return res.status(200).json({ error: false, message: 'Account and password are required' })
        }
        const user = await User.findOne({ account })
        const isValid = user && user.active !== false && (await bcrypt.compare(password, user.password))
        if (!isValid) {
            return res.status(200).json({ error: false, message: 'Invalid account or password' })
        }
        let activeStoreId = user.defaultStoreId?.toString()
        if (storeId && !mongoose.isValidObjectId(storeId)) {
            return res.status(400).json({ error: true, message: 'Invalid store id' })
        }
        if (storeId) {
            const selectedStore = await Store.findOne({ _id: storeId, active: true }).select({ _id: 1 }).lean()
            const hasAccess = user.role === Role.SuperAdmin || user.storeIds?.some((id) => id.toString() === String(storeId))
            if (!selectedStore || !hasAccess) return res.status(403).json({ error: true, message: 'You do not have access to this store' })
            activeStoreId = String(storeId)
        }
        if (!activeStoreId) {
            return res.status(403).json({ error: true, message: 'User is not assigned to a store' })
        }
        const payload = {
            account: user.account,
            role: user.role,
            storeId: activeStoreId,
        }
        const { accessToken, refreshToken } = await generateTokens(payload)

        await UserToken.findOneAndUpdate(
            { account: payload.account },
            { account: payload.account, token: refreshToken },
            { returnDocument: 'after' },
        )

        await User.findOneAndUpdate(
            { account: payload.account },
            {
                $set: {
                    isOnline: true,
                    lastTimeOnline: new Date(),
                },
            },
        )
        res.cookie('jwt', refreshToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 1000 * 60 * 60 * 24 * 365,
        })

        return res.status(200).json({
            error: false,
            accessToken,
            user: {
                id: user._id?.toString(),
                account: user.account,
                role: user.role,
                storeId: payload.storeId,
            },
            message: 'Logged in successfully',
        })
    } catch (err) {
        console.log('login err', err)
        return res.status(200).json({ error: false, message: 'Internal Server Error' })
    }
}

export const logout = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authReq = req as AuthRequest
        const user = authReq.user
        if (!user) return res.status(200).json({ error: false, message: 'Logged Out Successfully' })

        const userToken = await UserToken.findOne({ account: user.account })

        await User.findOneAndUpdate(
            { account: user.account },
            {
                $set: {
                    isOnline: false,
                    lastTimeOnline: new Date(),
                },
            },
        )

        if (!userToken) return res.status(200).json({ error: false, message: 'Logged Out Successfully' })

        await userToken.deleteOne()
        res.status(200).json({ error: false, message: 'Logged Out Successfully' })
    } catch (err) {
        next(
            customError({
                msg: 'Internal Server Error',
                status: 'failed',
                statusCode: 500,
            }),
        )
    }
}
export const getLoginStores = async (req: Request, res: Response) => {
    try {
        const { account, password } = req.body
        const user = await User.findOne({ account }).select({ password: 1, role: 1, storeIds: 1 }).lean()
        if (!user || user.active === false || !password || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: true, message: 'Invalid account or password' })
        const filter = user.role === Role.SuperAdmin ? { active: true } : { _id: { $in: user.storeIds || [] }, active: true }
        const stores = await Store.find(filter).select({ code: 1, name: 1 }).sort({ name: 1 }).lean()
        res.json({ error: false, role: user.role, data: stores })
    } catch (error: any) {
        res.status(500).json({ error: true, message: error.message })
    }
}

export async function ensureDefaultUsers() {
    const store = await Store.findOneAndUpdate(
        { code: 'main' },
        { $setOnInsert: { code: 'main', name: 'Cửa hàng chính', timezone: 'Asia/Taipei' } },
        { upsert: true, returnDocument: 'after' },
    )
    if (!store) throw new Error('Unable to initialize default store')
    await User.updateMany({ active: { $exists: false } }, { $set: { active: true } })
    const account = 'superadmin'
    const password = 'Hubert*17041993'
    const hashPassword = await bcrypt.hash(password, Number(process.env.SALT) || 10)
    await User.findOneAndUpdate(
        { account },
        {
            $set: { password: hashPassword, role: Role.SuperAdmin, active: true },
            $setOnInsert: { storeIds: [store._id], defaultStoreId: store._id },
        },
        { upsert: true, returnDocument: 'after' },
    )
}
