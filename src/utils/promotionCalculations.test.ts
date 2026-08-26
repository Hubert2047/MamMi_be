import { describe, expect, it } from 'vitest'
import { calculatePromotionPricing, isPromotionAvailableAt, matchesExpectedPromotionPricing } from './promotionCalculations.js'

const items = [{ id: 'tea', basePrice: 60, quantity: 2, addons: [{ id: 'boba', amount: 1, priceExtra: 20 }, { id: 'pudding', amount: 1, priceExtra: 30 }] }]

describe('promotion calculations', () => {
    it('does not make an active promotion available after endsAt, and respects the exact end instant', () => {
        const endsAt = new Date('2026-08-26T10:00:00.000Z')
        expect(isPromotionAvailableAt({ status: 'active', endsAt }, endsAt)).toBe(true)
        expect(isPromotionAvailableAt({ status: 'active', endsAt }, new Date('2026-08-26T10:00:00.001Z'))).toBe(false)
    })

    it('does not make a promotion available before startsAt or when status is not active', () => {
        const startsAt = new Date('2026-08-26T10:00:00.000Z')
        expect(isPromotionAvailableAt({ status: 'active', startsAt }, new Date('2026-08-26T09:59:59.999Z'))).toBe(false)
        expect(isPromotionAvailableAt({ status: 'draft', startsAt }, startsAt)).toBe(false)
        expect(isPromotionAvailableAt({ status: 'archived' }, new Date())).toBe(false)
    })

    it('rejects a stale client pricing snapshot when amount or promotion version changes', () => {
        const actual = { total: 170, appliedPromotions: [{ promotionId: 'p1', promotionVersion: 2, name: 'Promotion', mode: 'automatic' as const, discountAmount: 50, allocations: [] }] }
        expect(matchesExpectedPromotionPricing({ ...actual, appliedPromotions: [{ ...actual.appliedPromotions[0]!, promotionVersion: 1 }] }, actual)).toBe(false)
        expect(matchesExpectedPromotionPricing({ ...actual, total: 171 }, actual)).toBe(false)
        expect(matchesExpectedPromotionPricing(actual, actual)).toBe(true)
    })

    it('automatically applies independent product and add-on rules per configured item quantity', () => {
        const result = calculatePromotionPricing(items, [{ id: 'auto', name: 'Tea and boba', version: 1, mode: 'automatic', priority: 10, combinable: true, rules: [
            { target: 'product', productIds: ['tea'], reward: { type: 'percent', amount: 10 } },
            { target: 'addon', addonIds: ['boba'], reward: { type: 'value', amount: 10 } },
        ] }])
        expect(result.total).toBe(188)
        expect(result.appliedPromotions[0]?.discountAmount).toBe(32)
    })

    it('clamps every excessive fixed or percentage reward at the remaining amount so the payable total never becomes negative', () => {
        const result = calculatePromotionPricing([{ id: 'tea', basePrice: 60, quantity: 1, addons: [{ id: 'boba', amount: 1, priceExtra: 20 }] }], [{
            id: 'oversized', name: 'Oversized', version: 1, mode: 'automatic', priority: 1, combinable: true, rules: [
                { target: 'product', productIds: ['tea'], reward: { type: 'value', amount: 999 } },
                { target: 'addon', addonIds: ['boba'], reward: { type: 'percent', amount: 100 } },
                { target: 'order', reward: { type: 'value', amount: 999 } },
            ],
        }])
        expect(result.total).toBe(0)
        expect(result.appliedPromotions[0]?.discountAmount).toBe(80)
    })

    it('requires explicit selection for manual promotions and applies order reductions after item reductions', () => {
        const promotions = [
            { id: 'manual', name: 'Order reward', version: 1, mode: 'manual' as const, minSubtotal: 100, priority: 1, combinable: true, rules: [{ target: 'order' as const, reward: { type: 'value' as const, amount: 50 } }] },
        ]
        expect(calculatePromotionPricing(items, promotions).total).toBe(220)
        const result = calculatePromotionPricing(items, promotions, ['manual'])
        expect(result.total).toBe(170)
        expect(result.appliedPromotions[0]?.targets).toEqual(['order'])
    })

    it('applies product, addon, line, then order rules on the remaining amounts and records the allocation', () => {
        const result = calculatePromotionPricing([{ id: 'tea', basePrice: 100, quantity: 1, addons: [{ id: 'boba', amount: 1, priceExtra: 20 }] }], [{
            id: 'stacked', name: 'Stacked', version: 1, mode: 'automatic', priority: 1, combinable: true, rules: [
                { target: 'product', productIds: ['tea'], reward: { type: 'value', amount: 10 } },
                { target: 'addon', addonIds: ['boba'], reward: { type: 'value', amount: 5 } },
                { target: 'line', productIds: ['tea'], reward: { type: 'value', amount: 20 } },
                { target: 'order', reward: { type: 'value', amount: 10 } },
            ],
        }])
        expect(result.total).toBe(75)
        expect(result.appliedPromotions[0]?.discountAmount).toBe(45)
        expect(result.appliedPromotions[0]?.targets).toEqual(['product', 'addon', 'line', 'order'])
        expect(result.appliedPromotions[0]?.allocations).toEqual([{ itemId: 'tea', productDiscountAmount: 40, addonDiscounts: [{ addonId: 'boba', discountAmount: 5 }] }])
    })

    it('keeps non-combinable promotions exclusive by priority', () => {
        const result = calculatePromotionPricing(items, [
            { id: 'low', name: 'Low', version: 1, mode: 'automatic', priority: 1, combinable: false, rules: [{ target: 'order', reward: { type: 'value', amount: 20 } }] },
            { id: 'high', name: 'High', version: 1, mode: 'automatic', priority: 2, combinable: false, rules: [{ target: 'order', reward: { type: 'value', amount: 40 } }] },
        ])
        expect(result.total).toBe(180)
        expect(result.appliedPromotions.map((promotion) => promotion.promotionId)).toEqual(['high'])
    })

    it('allows only one automatic whole-order promotion even when both are marked combinable', () => {
        const result = calculatePromotionPricing(items, [
            { id: 'lower', name: 'Lower', version: 1, mode: 'automatic', priority: 1, combinable: true, rules: [{ target: 'order', reward: { type: 'value', amount: 20 } }] },
            { id: 'higher', name: 'Higher', version: 1, mode: 'automatic', priority: 2, combinable: true, rules: [{ target: 'order', reward: { type: 'value', amount: 40 } }] },
        ])
        expect(result.appliedPromotions.map((promotion) => promotion.promotionId)).toEqual(['higher'])
    })

    it('uses the larger reward when exclusive promotions share a priority', () => {
        const result = calculatePromotionPricing(items, [
            { id: 'small', name: 'Small', version: 1, mode: 'automatic', priority: 1, combinable: false, rules: [{ target: 'order', reward: { type: 'value', amount: 20 } }] },
            { id: 'large', name: 'Large', version: 1, mode: 'automatic', priority: 1, combinable: false, rules: [{ target: 'order', reward: { type: 'value', amount: 40 } }] },
        ])
        expect(result.appliedPromotions.map((promotion) => promotion.promotionId)).toEqual(['large'])
    })
})
