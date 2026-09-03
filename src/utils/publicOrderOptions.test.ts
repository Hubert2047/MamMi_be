import { describe, expect, it } from 'vitest'
import { normalizePublicOptionSelections } from './publicOrderOptions.js'

const groups = [{ id: 'ice', required: true, selection: 'single' as const, options: [{ id: 'normal', names: { vi: 'Đá thường' } }, { id: 'less', names: { vi: 'Ít đá' } }] }]

describe('public order option validation', () => {
    it('requires a required group and rejects invalid or multiple single-choice selections', () => {
        expect(() => normalizePublicOptionSelections([], groups)).toThrow('REQUIRED_OPTION_MISSING')
        expect(() => normalizePublicOptionSelections([{ groupId: 'ice', optionId: 'missing' }], groups)).toThrow('INVALID_OPTION')
        expect(() => normalizePublicOptionSelections([{ groupId: 'ice', optionId: 'normal' }, { groupId: 'ice', optionId: 'less' }], groups)).toThrow('INVALID_OPTION')
        expect(normalizePublicOptionSelections([{ groupId: 'ice', optionId: 'less' }], groups)).toEqual([{ groupId: 'ice', optionId: 'less', name: 'Ít đá' }])
    })
})
