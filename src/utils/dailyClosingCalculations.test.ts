import { describe, expect, it } from 'vitest'
import { calculateActualCash, calculateSystemAmount, isValidCashData, requiresClosingReason } from './dailyClosingCalculations.js'

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
})
