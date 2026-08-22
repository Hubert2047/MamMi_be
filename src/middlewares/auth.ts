import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { customError } from '../utils/index.js'

export enum Role {
    SuperAdmin = 'SuperAdmin',
    Admin = 'Admin',
    Employee = 'Employee',
    Guest = 'Guest',
}
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
        req.user = user
        next()
    } catch (error: any) {
        return res.status(401).json({ error: true, message: 'Invalid token' })
    }
}
