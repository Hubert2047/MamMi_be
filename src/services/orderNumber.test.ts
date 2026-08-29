import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    closingFindOne: vi.fn(),
    orderFindOne: vi.fn(),
    counterFindOne: vi.fn(),
    counterFindOneAndUpdate: vi.fn(),
    counterCreate: vi.fn(),
}))

vi.mock('../models/daily-closing.js', () => ({ default: { findOne: mocks.closingFindOne } }))
vi.mock('../models/order.js', () => ({ default: { findOne: mocks.orderFindOne } }))
vi.mock('../models/order-counter.js', () => ({
    default: {
        findOne: mocks.counterFindOne,
        findOneAndUpdate: mocks.counterFindOneAndUpdate,
        create: mocks.counterCreate,
    },
}))

import { allocateOrderSequence, getCurrentOrderPeriodId, getNextOrderSequence } from './orderNumber.js'

describe('order numbering', () => {
    beforeEach(() => {
        mocks.closingFindOne.mockReset()
        mocks.orderFindOne.mockReset()
        mocks.counterFindOne.mockReset()
        mocks.counterFindOneAndUpdate.mockReset()
        mocks.counterCreate.mockReset()
    })

    it('uses the latest non-voided closing as the counter period', async () => {
        mocks.closingFindOne.mockReturnValue({
            sort: () => ({ select: () => ({ lean: async () => ({ _id: 'closing-42' }) }) }),
        })

        await expect(getCurrentOrderPeriodId('store-a')).resolves.toBe('closing-42')
        expect(mocks.closingFindOne).toHaveBeenCalledWith({ storeId: 'store-a', status: { $ne: 'voided' } })
    })

    it('starts the first period at one without reserving a number', async () => {
        mocks.counterFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) })
        mocks.orderFindOne.mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => null }) }) })

        await expect(getNextOrderSequence('store-a', 'open')).resolves.toBe(1)
        expect(mocks.counterFindOne).toHaveBeenCalledWith({ storeId: 'store-a', periodId: 'open' })
    })

    it('starts a new closing period at one and retries an initial upsert race', async () => {
        const duplicateKey = Object.assign(new Error('duplicate'), { code: 11000 })
        mocks.counterFindOne
            .mockReturnValueOnce({ select: () => ({ lean: async () => null }) })
            .mockReturnValueOnce({ select: () => ({ lean: async () => ({ sequence: 2 }) }) })
        mocks.counterCreate.mockRejectedValueOnce(duplicateKey)
        mocks.counterFindOneAndUpdate.mockResolvedValueOnce({ sequence: 3 })

        await expect(allocateOrderSequence('store-a', 'closing-42')).resolves.toBe(3)
        expect(mocks.counterCreate).toHaveBeenCalledWith({ storeId: 'store-a', periodId: 'closing-42', sequence: 1 })
        expect(mocks.counterFindOneAndUpdate).toHaveBeenCalledTimes(1)
        expect(mocks.counterFindOneAndUpdate).toHaveBeenCalledWith(
            { storeId: 'store-a', periodId: 'closing-42' },
            { $inc: { sequence: 1 } },
            { returnDocument: 'after' },
        )
    })
})
