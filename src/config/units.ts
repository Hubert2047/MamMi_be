export type UnitCategory = 'weight' | 'volume' | 'count'

export type ExpenseUnitConfig = {
    code: string
    names: {
        vi: string
        en: string
        'zh-TW': string
    }
    category: UnitCategory
    baseUnit: string
    conversionFactor: number
}

export const expenseUnits: ExpenseUnitConfig[] = [
    { code: 'kg', names: { vi: 'Kilogram', en: 'Kilogram', 'zh-TW': '公斤' }, category: 'weight', baseUnit: 'g', conversionFactor: 1000 },
    { code: 'g', names: { vi: 'Gram', en: 'Gram', 'zh-TW': '公克' }, category: 'weight', baseUnit: 'g', conversionFactor: 1 },
    { code: 'l', names: { vi: 'Lít', en: 'Liter', 'zh-TW': '公升' }, category: 'volume', baseUnit: 'ml', conversionFactor: 1000 },
    { code: 'ml', names: { vi: 'Mililit', en: 'Milliliter', 'zh-TW': '毫升' }, category: 'volume', baseUnit: 'ml', conversionFactor: 1 },
    { code: 'piece', names: { vi: 'Cái', en: 'Piece', 'zh-TW': '個' }, category: 'count', baseUnit: 'piece', conversionFactor: 1 },
    { code: 'pack', names: { vi: 'Gói', en: 'Pack', 'zh-TW': '包' }, category: 'count', baseUnit: 'piece', conversionFactor: 1 },
    { code: 'box', names: { vi: 'Hộp', en: 'Box', 'zh-TW': '盒' }, category: 'count', baseUnit: 'piece', conversionFactor: 1 },
    { code: 'bottle', names: { vi: 'Chai', en: 'Bottle', 'zh-TW': '瓶' }, category: 'count', baseUnit: 'piece', conversionFactor: 1 },
    { code: 'carton', names: { vi: 'Thùng', en: 'Carton', 'zh-TW': '箱' }, category: 'count', baseUnit: 'piece', conversionFactor: 1 },
    { code: 'serving', names: { vi: 'Suất', en: 'Serving', 'zh-TW': '份' }, category: 'count', baseUnit: 'piece', conversionFactor: 1 },
    { code: 'occurrence', names: { vi: 'Lần', en: 'Occurrence', 'zh-TW': '次' }, category: 'count', baseUnit: 'occurrence', conversionFactor: 1 },
]
