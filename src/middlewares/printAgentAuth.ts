import type { NextFunction, Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { createHash } from 'node:crypto'
import PrintAgent from '../models/print-agent.js'

export interface PrintAgentRequest extends Request {
    printAgent: { agentId: string; agentDbId: string; storeId: string }
}

const sameSecret = (actual: string, expected: string) => {
    const actualBuffer = Buffer.from(actual)
    const expectedBuffer = Buffer.from(expected)
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
}

export default function authenticatePrintAgent(req: Request, res: Response, next: NextFunction) {
    const token = String(req.headers['x-agent-token'] || '')
    const agentId = String(req.headers['x-agent-id'] || '')
    if (!token || !agentId) return res.status(401).json({ success: false, message: 'Invalid print agent credentials' })
    void PrintAgent.findOne({ agentId, active: true }).select('+tokenHash').lean().then((agent) => {
        const tokenHash = createHash('sha256').update(token).digest('hex')
        if (!agent || !sameSecret(tokenHash, agent.tokenHash)) return res.status(401).json({ success: false, message: 'Invalid print agent credentials' })
        void PrintAgent.updateOne({ _id: agent._id }, { $set: { lastSeenAt: new Date() } })
        ;(req as PrintAgentRequest).printAgent = { agentId, agentDbId: String(agent._id), storeId: String(agent.storeId) }
        next()
    }).catch(() => res.status(401).json({ success: false, message: 'Invalid print agent credentials' }))
}
