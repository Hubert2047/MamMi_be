import { describe, expect, it } from 'vitest'
import DailyClosing from './daily-closing.js'

describe('DailyClosing concurrency index', () => {
    it('allows only one confirmed closing per store and period start', () => {
        const indexes = DailyClosing.schema.indexes()
        expect(indexes).toContainEqual([
            { storeId: 1, periodStart: 1 },
            { unique: true, partialFilterExpression: { status: 'confirmed' }, name: 'unique_confirmed_closing_period' },
        ])
    })
})
