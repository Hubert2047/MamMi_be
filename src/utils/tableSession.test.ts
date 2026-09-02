import { describe, expect, it } from 'vitest'
import { TABLE_SESSION_DURATION_MS, tableSessionExpiry } from './tableSession.js'

describe('table session duration', () => {
    it('keeps every newly opened session active for 12 hours', () => {
        const openedAt = new Date('2026-09-02T00:00:00.000Z')

        expect(TABLE_SESSION_DURATION_MS).toBe(12 * 60 * 60 * 1000)
        expect(tableSessionExpiry(openedAt).toISOString()).toBe('2026-09-02T12:00:00.000Z')
    })
})
