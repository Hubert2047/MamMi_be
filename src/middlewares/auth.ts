import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { customError } from '../utils/index.js'
import User from '../models/user.js'
import Store from '../models/store.js'
import { Role } from '../constants/role.js'
export { Role } from '../constants/role.js'
export interface T_UserToken {
    account: string
    role: Role
    storeId: string
}
export interface AuthRequest extends Request {
    user: T_UserToken
}

//key = Authorization, value = Bearer + token
export default async function authenticateToken(req: any, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (token == null) return res.sendStatus(401)

    try {
        const user: any = jwt.verify(token, process.env.ACCESS_TOKEN_PRIVATE_KEY as string)
        const requestedStoreId = req.headers['x-store-id']
        if (requestedStoreId) {
            const storeId = String(requestedStoreId)
            const store = await Store.findOne({ _id: storeId, active: true }).select({ _id: 1 }).lean()
            if (!store) return res.status(403).json({ error: true, message: 'Store is not available' })
            if (user.role !== Role.SuperAdmin) {
                const account = await User.findOne({ account: user.account }).select({ storeIds: 1 }).lean()
                if (!account?.storeIds?.some((id) => String(id) === storeId)) {
                    return res.status(403).json({ error: true, message: 'You do not have access to this store' })
                }
            }
            user.storeId = storeId
        }
        req.user = user
        next()
    } catch (error: any) {
        return res.status(401).json({ error: true, message: 'Invalid token' })
    }
}
