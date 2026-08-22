import DailyClosing from '../models/daily-closing.js'

export class FinancialPeriodClosedError extends Error {
    statusCode = 409

    constructor() {
        super('Financial data belongs to a confirmed closing period')
        this.name = 'FinancialPeriodClosedError'
    }
}

export async function isFinancialPeriodClosed(timestamp: Date): Promise<boolean> {
    const closing = await DailyClosing.findOne({
        status: 'confirmed',
        periodStart: { $lt: timestamp },
        periodEnd: { $gte: timestamp },
    }).select({ _id: 1 }).lean()

    return Boolean(closing)
}

export async function assertFinancialPeriodOpen(timestamp: Date): Promise<void> {
    if (await isFinancialPeriodClosed(timestamp)) throw new FinancialPeriodClosedError()
}
