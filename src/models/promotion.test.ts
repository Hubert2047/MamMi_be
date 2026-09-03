import { describe, expect, it } from 'vitest'
import Promotion from './promotion.js'

const base = { names: { vi: 'Khuyến mại', en: 'Promotion', 'zh-TW': '優惠' }, mode: 'automatic', rules: [{ target: 'order', reward: { type: 'value', amount: 10 } }] }

describe('Promotion money validation', () => {
    it('rejects decimal fixed discounts and subtotals but permits decimal percentages', async () => {
        await expect(new Promotion({ ...base, rules: [{ target: 'order', reward: { type: 'value', amount: 10.5 } }] }).validate()).rejects.toThrow()
        await expect(new Promotion({ ...base, minSubtotal: 10.5 }).validate()).rejects.toThrow()
        await expect(new Promotion({ ...base, rules: [{ target: 'order', reward: { type: 'percent', amount: 12.5 } }] }).validate()).resolves.toBeUndefined()
    })
})
