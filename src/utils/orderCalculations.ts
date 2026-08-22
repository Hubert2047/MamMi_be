export type OrderCalculationAddon = {
    amount: number
    priceExtra: number
}

export type OrderCalculationItem = {
    basePrice: number
    quantity: number
    addons: OrderCalculationAddon[]
}

export type OrderCalculationDiscount = {
    amount: number
    type: 'percent' | 'value'
} | null | undefined

export const calculateOrderItemTotal = (item: OrderCalculationItem): number => {
    const itemTotal = item.basePrice * item.quantity
    const addonTotal = item.addons.reduce((sum, addon) => sum + addon.amount * addon.priceExtra, 0)
    return itemTotal + addonTotal
}

export const calculateOrderSubtotal = (items: OrderCalculationItem[]): number =>
    items.reduce((sum, item) => sum + calculateOrderItemTotal(item), 0)

export const calculateTotal = (
    items: OrderCalculationItem[],
    discount: OrderCalculationDiscount,
): number => {
    const subtotal = calculateOrderSubtotal(items)
    if (!discount) return subtotal

    const discountedTotal = discount.type === 'percent'
        ? subtotal * (1 - discount.amount / 100)
        : subtotal - discount.amount

    return Math.max(0, discountedTotal)
}
