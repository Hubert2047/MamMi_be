import { describe, expect, it } from 'vitest'
import { isStoreItemAvailable, nextStoreMidnight } from './storeAvailability.js'

describe('store item availability', () => {
    it('requires permanent availability', () => {
        expect(isStoreItemAvailable({ permanentlyActive: false, temporarilyUnavailable: false })).toBe(false)
    })

    it('hides a temporarily unavailable item until its expiry', () => {
        const now = new Date('2026-08-22T10:00:00.000Z')
        const until = new Date('2026-08-22T16:00:00.000Z')
        expect(isStoreItemAvailable({ permanentlyActive: true, temporarilyUnavailable: true, temporarilyUnavailableUntil: until }, now)).toBe(false)
        expect(isStoreItemAvailable({ permanentlyActive: true, temporarilyUnavailable: true, temporarilyUnavailableUntil: until }, new Date('2026-08-22T17:00:00.000Z'))).toBe(true)
    })

    it('calculates the next midnight in the store timezone', () => {
        expect(nextStoreMidnight(new Date('2026-08-22T15:00:00.000Z'), 'Asia/Taipei').toISOString()).toBe('2026-08-22T16:00:00.000Z')
    })
})
