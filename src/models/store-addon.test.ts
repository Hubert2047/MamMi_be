import { describe, expect, it } from 'vitest'
import StoreAddon from './store-addon.js'

describe('StoreAddon', () => {
    it('has a unique store/addon index and an active lookup index', () => {
        const indexes = StoreAddon.schema.indexes().map(([keys, options]) => ({ keys, options }))
        expect(indexes).toContainEqual({ keys: { storeId: 1, addonId: 1 }, options: { unique: true } })
        expect(indexes).toContainEqual({ keys: { storeId: 1, active: 1 }, options: {} })
    })
})
