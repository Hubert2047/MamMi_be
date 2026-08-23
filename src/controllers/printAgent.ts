import type { Request, Response } from 'express'
import PrintJob from '../models/print-job.js'
import type { PrintAgentRequest } from '../middlewares/printAgentAuth.js'

const retryAfterMs = 2 * 60 * 1000

export const claimPrintJob = async (req: Request, res: Response) => {
    try {
        const { agentId, storeId } = (req as PrintAgentRequest).printAgent
        const now = new Date()
        const job = await PrintJob.findOneAndUpdate(
            { storeId, $or: [{ status: 'queued' }, { status: 'processing', lockedAt: { $lt: new Date(now.getTime() - retryAfterMs) } }] },
            { $set: { status: 'processing', agentId, lockedAt: now }, $inc: { attempts: 1 } },
            { sort: { createdAt: 1 }, returnDocument: 'after' },
        ).lean()
        res.json({ success: true, data: job })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to claim print job', error })
    }
}

export const completePrintJob = async (req: Request, res: Response) => {
    const { agentId, storeId } = (req as PrintAgentRequest).printAgent
    const id = String(req.params.id)
    const job = await PrintJob.findOneAndUpdate(
        { _id: id, storeId, status: 'processing', agentId },
        { $set: { status: 'printed', printedAt: new Date() }, $unset: { lockedAt: 1, lastError: 1 } },
        { returnDocument: 'after' },
    ).lean()
    if (!job) return res.status(404).json({ success: false, message: 'Print job not found' })
    res.json({ success: true, data: job })
}

export const failPrintJob = async (req: Request, res: Response) => {
    const { agentId, storeId } = (req as PrintAgentRequest).printAgent
    const id = String(req.params.id)
    const job = await PrintJob.findOne({ _id: id, storeId, status: 'processing', agentId })
    if (!job) return res.status(404).json({ success: false, message: 'Print job not found' })
    const updated = await PrintJob.findOneAndUpdate(
        { _id: id, storeId, status: 'processing', agentId },
        {
            $set: {
                lastError: String(req.body?.error || 'Print failed').slice(0, 1000),
                status: 'failed',
            },
            $unset: { lockedAt: 1 },
        },
        { returnDocument: 'after' },
    ).lean()
    res.json({ success: true, data: updated })
}
