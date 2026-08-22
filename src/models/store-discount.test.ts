import { describe, expect, it } from 'vitest'
import StoreDiscount from './store-discount.js'

describe('StoreDiscount model', () => {
    it('keeps discount configuration unique per store', () => {
        const indexes = StoreDiscount.schema.indexes().map(([keys, options]) => ({ keys, options }))
        expect(indexes).toContainEqual({ keys: { storeId: 1, discountId: 1 }, options: { unique: true } })
    })
})
