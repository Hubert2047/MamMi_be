import StorePromotion from '../models/store-promotion.js'
import Promotion from '../models/promotion.js'
import { calculatePromotionPricing, isPromotionAvailableAt, type PricePromotion, type PromotionOrderItem } from '../utils/promotionCalculations.js'

/** Persist expiry lazily on every promotion read/pricing path; `endsAt` remains inclusive. */
export const expireEndedPromotions = async (now = new Date()) => Promotion.updateMany(
    { status: 'active', endsAt: { $lt: now } },
    { $set: { status: 'expired' } },
)

export const calculateStorePromotionPricing = async (storeId: string, items: PromotionOrderItem[], selectedPromotionIds: string[] = []) => {
    const now = new Date()
    await expireEndedPromotions(now)
    const configs = await StorePromotion.find({ storeId, enabled: true }).populate('promotionId').lean()
    const promotions: PricePromotion[] = configs.flatMap((config: any) => {
        const promotion = config.promotionId as any
        if (!promotion || !isPromotionAvailableAt(promotion, now)) return []
        const names = { vi: promotion.names.vi || '', en: promotion.names.en || '', 'zh-TW': promotion.names['zh-TW'] || '' }
        return [{ id: String(promotion._id), name: names.vi || names.en || names['zh-TW'], names, version: promotion.version, mode: promotion.mode, minSubtotal: promotion.minSubtotal, priority: promotion.priority, combinable: promotion.combinable, exclusiveGroup: promotion.exclusiveGroup, rules: promotion.rules.map((rule: any) => ({ target: rule.target, productIds: rule.productIds.map(String), addonIds: rule.addonIds.map(String), reward: rule.reward })) }]
    })
    return calculatePromotionPricing(items, promotions, selectedPromotionIds)
}

/** Public-menu projection: only data needed to show automatic product/add-on rewards. */
export const getPublicCatalogPromotions = async (storeId: string) => {
    const now = new Date()
    await expireEndedPromotions(now)
    const configs = await StorePromotion.find({ storeId, enabled: true }).populate('promotionId').lean()
    return configs.flatMap((config: any) => {
        const promotion = config.promotionId as any
        if (!promotion || promotion.mode !== 'automatic' || !isPromotionAvailableAt(promotion, now)) return []
        return [{
            id: String(promotion._id),
            names: {
                vi: promotion.names?.vi || '',
                en: promotion.names?.en || '',
                'zh-TW': promotion.names?.['zh-TW'] || '',
            },
            descriptions: publicPromotionDescriptions(promotion),
            imageUrl: promotion.imageUrl || undefined,
            minSubtotal: promotion.minSubtotal,
            startsAt: promotion.startsAt || undefined,
            endsAt: promotion.endsAt || undefined,
            priority: promotion.priority,
            combinable: promotion.combinable,
            exclusiveGroup: promotion.exclusiveGroup || '',
            rules: promotion.rules.map((rule: any) => ({
                target: rule.target,
                productIds: rule.productIds.map(String),
                addonIds: rule.addonIds.map(String),
                reward: rule.reward,
            })),
        }]
    })
}

const displayDiscount = (price: number, reward: { type: 'percent' | 'value'; amount: number }) => Math.min(price, Math.max(0, reward.type === 'percent' ? price * reward.amount / 100 : reward.amount))

const publicPromotionDescriptions = (promotion: any) => {
    const targetLabels = {
        vi: { order: 'toàn bộ đơn hàng', product: 'sản phẩm được chọn', addon: 'topping được chọn', line: 'món được chọn' },
        en: { order: 'the entire order', product: 'selected products', addon: 'selected add-ons', line: 'selected items' },
        'zh-TW': { order: '整筆訂單', product: '指定餐點', addon: '指定加料', line: '指定品項' },
    }
    const descriptions = (locale: 'vi' | 'en' | 'zh-TW') => promotion.rules.map((rule: any) => {
        const discount = rule.reward.type === 'percent' ? `${rule.reward.amount}%` : `${rule.reward.amount} NT$`
        const target = targetLabels[locale][rule.target as keyof typeof targetLabels.vi] || targetLabels[locale].product
        if (locale === 'vi') return `Giảm ${discount} cho ${target}${promotion.minSubtotal !== undefined ? ` từ ${promotion.minSubtotal} NT$ trở lên` : ''}`
        if (locale === 'en') return `Save ${discount} on ${target}${promotion.minSubtotal !== undefined ? ` for orders from ${promotion.minSubtotal} NT$` : ''}`
        const minimum = promotion.minSubtotal !== undefined ? `消費滿 NT$${promotion.minSubtotal}` : ''
        if (rule.target === 'order') {
            return rule.reward.type === 'percent'
                ? `${minimum}${minimum ? ' ' : ''}享 ${Math.max(0, 10 - rule.reward.amount / 10)} 折優惠`
                : `${minimum}${minimum ? ' ' : ''}現折 NT$${rule.reward.amount}`
        }
        return `${target}享 ${rule.reward.type === 'percent' ? `${Math.max(0, 10 - rule.reward.amount / 10)} 折` : `現折 NT$${rule.reward.amount}`}優惠${minimum ? `，${minimum}` : ''}`
    }).join(' · ')
    return { vi: descriptions('vi'), en: descriptions('en'), 'zh-TW': descriptions('zh-TW') }
}

/** Pre-compute only context-free product/add-on display prices for public menus. */
export const applyPublicMenuPromotionDisplays = (items: any[], promotions: any[]) => items.map((item) => {
    const accepted = (matches: (rule: any) => boolean) => {
        const used = new Set<string>()
        return promotions.filter((promotion) => !promotion.minSubtotal && promotion.rules.some(matches)).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).filter((promotion) => {
            const group = promotion.exclusiveGroup || (promotion.combinable ? '' : 'default')
            if (group && used.has(group)) return false
            if (group) used.add(group)
            return true
        })
    }
    const productMatches = (rule: any) => rule.target === 'product' && (!rule.productIds.length || rule.productIds.includes(item.id))
    const displayPrice = accepted(productMatches).reduce((price, promotion) => promotion.rules.filter(productMatches).reduce((value: number, rule: any) => value - displayDiscount(value, rule.reward), price), item.price)
    return {
        ...item,
        displayPrice,
        promotion: displayPrice < item.price,
        addons: item.addons.map((addon: any) => {
            const addonMatches = (rule: any) => rule.target === 'addon' && (!rule.productIds.length || rule.productIds.includes(item.id)) && (!rule.addonIds.length || rule.addonIds.includes(addon.id))
            const addonDisplayPrice = accepted(addonMatches).reduce((price, promotion) => promotion.rules.filter(addonMatches).reduce((value: number, rule: any) => value - displayDiscount(value, rule.reward), price), addon.priceExtra)
            return { ...addon, displayPrice: addonDisplayPrice }
        }),
    }
})
