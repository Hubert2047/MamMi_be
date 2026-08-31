export type UnitCategory = 'weight' | 'volume' | 'count'

export type ExpenseUnitConfig = {
    code: string
    names: {
        vi: string
        en: string
        'zh-TW': string
    }
    category: UnitCategory
}

export const expenseUnits: ExpenseUnitConfig[] = [
    { code: 'kg', names: { vi: 'Kilogram', en: 'Kilogram', 'zh-TW': '公斤' }, category: 'weight' },
    { code: 'g', names: { vi: 'Gram', en: 'Gram', 'zh-TW': '公克' }, category: 'weight' },
    { code: 'l', names: { vi: 'Lít', en: 'Liter', 'zh-TW': '公升' }, category: 'volume' },
    { code: 'ml', names: { vi: 'Mililit', en: 'Milliliter', 'zh-TW': '毫升' }, category: 'volume' },
    { code: 'piece', names: { vi: 'Cái', en: 'Piece', 'zh-TW': '個' }, category: 'count' },
    { code: 'pack', names: { vi: 'Gói', en: 'Pack', 'zh-TW': '包' }, category: 'count' },
    { code: 'box', names: { vi: 'Hộp', en: 'Box', 'zh-TW': '盒' }, category: 'count' },
    { code: 'bottle', names: { vi: 'Chai', en: 'Bottle', 'zh-TW': '瓶' }, category: 'count' },
    { code: 'carton', names: { vi: 'Thùng', en: 'Carton', 'zh-TW': '箱' }, category: 'count' },
    { code: 'serving', names: { vi: 'Suất', en: 'Serving', 'zh-TW': '份' }, category: 'count' },
    { code: 'occurrence', names: { vi: 'Lần', en: 'Occurrence', 'zh-TW': '次' }, category: 'count' },
]
