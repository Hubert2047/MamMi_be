import { describe, expect, it } from 'vitest'
import { calculateActualCash, calculateSystemAmount, canVoidLatestClosing, getClosingPeriodFilter, isValidCashData, requiresClosingReason } from './dailyClosingCalculations.js'

describe('daily closing calculations', () => {
    it('calculates actual cash from denomination counts', () => {
        expect(calculateActualCash({ '2000': '2', '500': 3 })).toBe(5500)
    })

    it('accepts non-negative integer cash counts', () => {
        expect(isValidCashData({ '2000': 2, '500': '3' })).toBe(true)
        expect(isValidCashData({ '2000': -1 })).toBe(false)
        expect(isValidCashData({ '2000': 1.5 })).toBe(false)
        expect(isValidCashData({ 'abc': 1 })).toBe(false)
    })

    it('requires a reason when actual and system amounts differ', () => {
        expect(requiresClosingReason(5000, '')).toBe(true)
        expect(requiresClosingReason(-5000, '  ')).toBe(true)
        expect(requiresClosingReason(0, '')).toBe(false)
        expect(requiresClosingReason(5000, 'Đã kiểm tra lại')).toBe(false)
    })

    it('calculates the system amount from the daily source totals', () => {
        expect(calculateSystemAmount(50000, 200000, 30000, 45000)).toBe(235000)
    })

    it('starts the first closing period at the configured first-period start', () => {
        const firstStart = new Date('2026-08-22T00:00:00.000Z')
        const end = new Date('2026-08-22T10:00:00.000Z')

        expect(getClosingPeriodFilter(undefined, firstStart, end)).toEqual({ $gte: firstStart, $lte: end })
    })

    it('starts the next closing period after the previous closing timestamp across date boundaries', () => {
        const previousClosing = new Date('2026-08-21T15:00:00.000Z')
        const end = new Date('2026-08-22T09:00:00.000Z')

        expect(getClosingPeriodFilter(previousClosing, new Date('2026-08-22T00:00:00.000Z'), end))
            .toEqual({ $gt: previousClosing, $lte: end })
    })

    it('only allows voiding the latest confirmed closing', () => {
        expect(canVoidLatestClosing('latest', 'latest')).toBe(true)
        expect(canVoidLatestClosing('older', 'latest')).toBe(false)
    })
})
