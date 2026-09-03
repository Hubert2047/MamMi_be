import { describe, expect, it } from 'vitest'
import { getPaidAt, isCashReceivedSufficient } from './orderPaymentCalculations.js'

describe('order payment timestamps', () => {
    it('records the payment time when an order becomes paid', () => {
        const paidAt = new Date('2026-08-22T12:00:00.000Z')

        expect(getPaidAt('paid', paidAt)).toBe(paidAt)
    })

    it('does not record a payment time for unpaid statuses', () => {
        const now = new Date('2026-08-22T12:00:00.000Z')

        expect(getPaidAt('pending', now)).toBeUndefined()
        expect(getPaidAt('cancelled', now)).toBeUndefined()
    })

    it('accepts cash at or above the authoritative total only', () => {
        expect(isCashReceivedSufficient(100, 100)).toBe(true)
        expect(isCashReceivedSufficient(101, 100)).toBe(true)
        expect(isCashReceivedSufficient(99, 100)).toBe(false)
        expect(isCashReceivedSufficient(undefined, 100)).toBe(false)
        expect(isCashReceivedSufficient(Number.NaN, 100)).toBe(false)
    })
})
