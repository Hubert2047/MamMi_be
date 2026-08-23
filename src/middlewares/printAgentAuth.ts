import type { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'

export interface PrintAgentRequest extends Request {
    printAgent: { agentId: string; storeId: string }
}

const sameSecret = (actual: string, expected: string) => {
    const actualBuffer = Buffer.from(actual)
    const expectedBuffer = Buffer.from(expected)
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export default function authenticatePrintAgent(req: Request, res: Response, next: NextFunction) {
    const expectedToken = process.env.PRINT_AGENT_TOKEN
    const token = String(req.headers['x-agent-token'] || '')
    const storeId = String(req.headers['x-store-id'] || '')
    const agentId = String(req.headers['x-agent-id'] || '')
    if (!expectedToken || !storeId || !agentId || !sameSecret(token, expectedToken)) {
        return res.status(401).json({ success: false, message: 'Invalid print agent credentials' })
    }
    ;(req as PrintAgentRequest).printAgent = { agentId, storeId }
    next()
}
