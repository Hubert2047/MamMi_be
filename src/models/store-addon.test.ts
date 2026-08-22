import { describe, expect, it } from 'vitest'
import StoreAddon from './store-addon.js'

describe('StoreAddon', () => {
    it('has unique and availability lookup indexes', () => {
        const indexes = StoreAddon.schema.indexes().map(([keys, options]) => ({ keys, options }))
        expect(indexes).toContainEqual({ keys: { storeId: 1, addonId: 1 }, options: { unique: true } })
        expect(indexes).toContainEqual({ keys: { storeId: 1, permanentlyActive: 1, temporarilyUnavailable: 1 }, options: {} })
        expect(indexes).toContainEqual({ keys: { storeId: 1, temporarilyUnavailable: 1, temporarilyUnavailableUntil: 1 }, options: {} })
    })
})
