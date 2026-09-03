import { describe, expect, it } from 'vitest'
import StoreItem from './store-item.js'

describe('StoreItem availability fields', () => {
    it('defaults new store products to permanently sellable and not temporarily unavailable', () => {
        const item = new StoreItem({ storeId: '507f1f77bcf86cd799439011', itemId: '507f1f77bcf86cd799439012' })
        expect(item.permanentlyActive).toBe(true)
        expect(item.temporarilyUnavailable).toBe(false)
        expect(item.temporarilyUnavailableUntil).toBeNull()
    })

    it('keeps store-scoped availability indexes', () => {
        const indexes = StoreItem.schema.indexes().map(([keys]) => keys)
        expect(indexes).toContainEqual({ storeId: 1, itemId: 1 })
        expect(indexes).toContainEqual({ storeId: 1, permanentlyActive: 1, temporarilyUnavailable: 1 })
        expect(indexes).toContainEqual({ storeId: 1, temporarilyUnavailable: 1, temporarilyUnavailableUntil: 1 })
    })

    it('rejects decimal and negative store prices', async () => {
        await expect(new StoreItem({ storeId: '507f1f77bcf86cd799439011', itemId: '507f1f77bcf86cd799439012', price: { base: 10.5 } }).validate()).rejects.toThrow()
        await expect(new StoreItem({ storeId: '507f1f77bcf86cd799439011', itemId: '507f1f77bcf86cd799439012', price: { base: -1 } }).validate()).rejects.toThrow()
    })
})
