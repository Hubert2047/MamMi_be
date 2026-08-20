import bcrypt from 'bcrypt'
import type { Request, Response, NextFunction } from 'express'
import { Role, type AuthRequest } from '../middlewares/auth.js'
import User from '../models/user.js'
import { customError, generateTokens } from '../utils/index.js'
import UserToken from '../models/user-token.js'
export const login = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { account, password } = req.body
        if (!account || !password) {
            return res.status(200).json({ error: false, message: 'Account and password are required' })
        }
        const user = await User.findOne({ account })
        const isValid = user && (await bcrypt.compare(password, user.password))
        if (!isValid) {
            return res.status(200).json({ error: false, message: 'Invalid account or password' })
        }
        const payload = {
            account: user.account,
            role: user.role,
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
export const serverRegister = async (account: string, password: string, role: Role) => {
    try {
        const user = await User.findOne({
            account,
        })
        if (user) return
        const saltRounds = Number(process.env.SALT) || 10
        const salt = await bcrypt.genSalt(Number(saltRounds))
        const hashPassword = await bcrypt.hash(password, salt)

        await new User({
            account,
            role,
            password: hashPassword,
        }).save()

        console.log('User registered successfully')
    } catch (err) {
        console.log(err)
    }
}

export async function ensureDefaultUsers() {
    await serverRegister(
        process.env.DEFAULT_EMPLOYEE_ACCOUNT || 'employee',
        process.env.DEFAULT_EMPLOYEE_PASSWORD || 'employee',
        Role.Employee,
    )
    await serverRegister(
        process.env.DEFAULT_ADMIN_ACCOUNT || 'admin',
        process.env.DEFAULT_ADMIN_PASSWORD || 'admin123456',
        Role.Admin,
    )
}
