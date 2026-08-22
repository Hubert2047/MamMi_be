import jwt from 'jsonwebtoken'
import type { Role } from '../middlewares/auth.js'
import UserToken from '../models/user-token.js'
import { startOfDay, endOfDay } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
export type T_generateToken = {
    account: string
    role: Role
    storeId: string
}

export const TIME_ZONE = 'Asia/Taipei'

export const getFullDay = (daysAgo = 0) => {
    const now = new Date()
    const zonedNow = toZonedTime(now, TIME_ZONE)
    zonedNow.setDate(zonedNow.getDate() - daysAgo)
    const startZoned = startOfDay(zonedNow)
    const endZoned = endOfDay(zonedNow)
    const start = fromZonedTime(startZoned, TIME_ZONE)
    const end = fromZonedTime(endZoned, TIME_ZONE)
    return { start, end }
}
export const getFromDayUntilNow = (daysAgo = 0) => {
  const now = new Date()
  const zonedNow = toZonedTime(now, TIME_ZONE)
  zonedNow.setDate(zonedNow.getDate() - daysAgo)
  const startZoned = startOfDay(zonedNow)
  const start = fromZonedTime(startZoned, TIME_ZONE)
  const end = now 
  return { start, end }
}

export function customError({
    msg,
    status,
    statusCode,
    data = {},
}: {
    msg: string
    status: string
    statusCode: number
    data?: any
}) {
    console.log('error', msg)
    const err: any = new Error(msg)
    err.status = status
    err.statusCode = statusCode
    err.data = data
    return err
}
export function Err(next: any, error: any) {
    console.log('err', error.message)
    return next(
        customError({
            msg: error.message,
            status: 'failed',
            statusCode: 500,
        }),
    )
}

export const generateTokens = async (payload: T_generateToken) => {
    try {
        const accessToken = jwt.sign(payload, process.env.ACCESS_TOKEN_PRIVATE_KEY as string, { expiresIn: '1000d' })
        const refreshToken = jwt.sign(payload, process.env.REFRESH_TOKEN_PRIVATE_KEY as string, { expiresIn: '1000d' })

        return Promise.resolve({ accessToken, refreshToken })
    } catch (err) {
        return Promise.reject(err)
    }
}

export const verifyRefreshToken = (refreshToken: string) => {
    const privateKey = process.env.REFRESH_TOKEN_PRIVATE_KEY

    return new Promise(async (resolve, reject) => {
        try {
            const token = await UserToken.findOne({ token: refreshToken })
            if (!token) {
                return reject({
                    error: true,
                    message: 'Invalid refresh token',
                })
            }
            const tokenDetails = jwt.verify(refreshToken, privateKey as string)
            resolve({
                tokenDetails,
                error: false,
                message: 'Valid refresh token',
            })
        } catch (error) {
            return reject({
                error: true,
                message: 'Invalid refresh token',
            })
        }
    })
}
