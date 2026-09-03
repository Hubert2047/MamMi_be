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

    it('stores an immutable employee snapshot for the closing operator', () => {
        const employeeIdPath = DailyClosing.schema.path('confirmedByEmployee.employeeId')
        const numberIdPath = DailyClosing.schema.path('confirmedByEmployee.numberId')
        const namePath = DailyClosing.schema.path('confirmedByEmployee.name')

        expect(employeeIdPath?.options.ref).toBe('Employee')
        expect(numberIdPath?.options.required).toBe(true)
        expect(namePath?.options.required).toBe(true)
    })
})
