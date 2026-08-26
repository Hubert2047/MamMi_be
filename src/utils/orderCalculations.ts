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
    name?: string
    amount: number
    type: 'percent' | 'value'
} | null | undefined

export type OrderPriceBreakdown = {
    productSubtotal: number
    addonSubtotal: number
    subtotal: number
    discountAmount: number
    total: number
}

export const calculateOrderItemTotal = (item: OrderCalculationItem): number => {
    const itemTotal = item.basePrice * item.quantity
    // A line represents identical configured products, so each selected add-on
    // applies once to every unit in that line.
    const addonTotal = item.addons.reduce((sum, addon) => sum + addon.amount * addon.priceExtra * item.quantity, 0)
    return itemTotal + addonTotal
}

export const calculateOrderSubtotal = (items: OrderCalculationItem[]): number =>
    items.reduce((sum, item) => sum + calculateOrderItemTotal(item), 0)

export const calculateTotal = (
    items: OrderCalculationItem[],
    discount: OrderCalculationDiscount,
): number => {
    return calculateOrderPriceBreakdown(items, discount).total
}

export const calculateOrderPriceBreakdown = (
    items: OrderCalculationItem[],
    discount: OrderCalculationDiscount,
): OrderPriceBreakdown => {
    const productSubtotal = items.reduce((sum, item) => sum + item.basePrice * item.quantity, 0)
    const addonSubtotal = items.reduce((sum, item) => sum + item.addons.reduce(
        (addonSum, addon) => addonSum + addon.amount * addon.priceExtra * item.quantity,
        0,
    ), 0)
    const subtotal = productSubtotal + addonSubtotal
    if (!discount) return { productSubtotal, addonSubtotal, subtotal, discountAmount: 0, total: subtotal }

    const discountedTotal = discount.type === 'percent'
        ? subtotal * (1 - discount.amount / 100)
        : subtotal - discount.amount

    const total = Math.max(0, discountedTotal)
    return { productSubtotal, addonSubtotal, subtotal, discountAmount: subtotal - total, total }
}
