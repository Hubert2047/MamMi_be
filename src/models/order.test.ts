import { describe, expect, it } from 'vitest'
import mongoose from 'mongoose'
import Order from './order.js'

describe('Order multi-store invariants', () => {
    it('requires a store and defaults versioned POS metadata', () => {
        const order = new Order({ number: 1, items: [], totalPrice: 0, paymentMethod: 'cash' })
        expect(order.validateSync()?.errors.storeId).toBeTruthy()

        const scoped = new Order({ storeId: new mongoose.Types.ObjectId(), number: 1, items: [], totalPrice: 0, paymentMethod: 'cash' })
        expect(scoped.validateSync()).toBeUndefined()
        expect(scoped.source).toBe('pos')
        expect(scoped.version).toBe(1)
    })

    it('has period-scoped indexes for order numbers and provider idempotency', () => {
        const indexes = Order.schema.indexes().map(([keys, options]) => ({ keys, options }))
        expect(indexes).toContainEqual({ keys: { storeId: 1, periodId: 1, sequence: 1 }, options: { unique: true, partialFilterExpression: { periodId: { $type: 'string' }, sequence: { $type: 'number' } } } })
        expect(indexes).toContainEqual({ keys: { storeId: 1, source: 1, externalOrderId: 1 }, options: { unique: true, partialFilterExpression: { externalOrderId: { $type: 'string' } } } })
    })
})
