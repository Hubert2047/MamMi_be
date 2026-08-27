import Item, { type LocalizedOption } from '../models/item.js'
import StoreAddon from '../models/store-addon.js'
import StoreItem from '../models/store-item.js'

type LocalizedText = { vi: string; en: string; 'zh-TW': string }

const normalizeNames = (names: any): LocalizedText => ({
    vi: names?.vi || '',
    en: names?.en || '',
    'zh-TW': names?.['zh-TW'] || '',
})

const normalizeOptions = (options: unknown, prefix: string): LocalizedOption[] => (Array.isArray(options) ? options : []).map((option: any, index) => {
    if (typeof option === 'string') return { id: `${prefix}-${index + 1}`, names: { vi: option, en: option, 'zh-TW': option } }
    return { id: option?.id || `${prefix}-${index + 1}`, names: normalizeNames(option?.names) }
})

async function clearExpiredAvailability(storeId: string) {
    const expired = { storeId, temporarilyUnavailable: true, temporarilyUnavailableUntil: { $lte: new Date() } }
    await Promise.all([
        StoreItem.updateMany(expired, { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } }),
        StoreAddon.updateMany(expired, { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } }),
    ])
}

export async function getPublicMenu(storeId: string) {
    await clearExpiredAvailability(storeId)
    const storeItems = await StoreItem.find({ storeId, permanentlyActive: true, temporarilyUnavailable: false }).populate({
        path: 'itemId',
        populate: [
            { path: 'categoryId', select: 'names name sortOrder' },
            { path: 'addons', select: 'names name' },
            { path: 'components.itemId', select: 'names noteOptions' },
        ],
    }).lean()
    const addonIds = storeItems.flatMap((storeItem: any) => storeItem.itemId?.addons?.map((addon: any) => addon._id) || [])
    const storeAddons = await StoreAddon.find({ storeId, addonId: { $in: addonIds }, permanentlyActive: true, temporarilyUnavailable: false }).lean()
    const storeAddonById = new Map(storeAddons.map((addon: any) => [String(addon.addonId), addon]))

    const orderedStoreItems = [...storeItems].sort((left: any, right: any) => {
        const leftCategory = left.itemId?.categoryId
        const rightCategory = right.itemId?.categoryId
        const orderDifference = (Number(leftCategory?.sortOrder) || 0) - (Number(rightCategory?.sortOrder) || 0)
        if (orderDifference) return orderDifference
        const leftName = leftCategory?.names?.vi || leftCategory?.name || ''
        const rightName = rightCategory?.names?.vi || rightCategory?.name || ''
        return leftName.localeCompare(rightName)
    })

    return orderedStoreItems.flatMap((storeItem: any) => {
        const item = storeItem.itemId
        if (!item) return []
        const basePrice = Number(storeItem.price?.base ?? 0)
        if (!Number.isFinite(basePrice)) return []
        const category = item.categoryId
        return [{
            id: String(item._id),
            names: normalizeNames(item.names),
            description: normalizeNames(item.description),
            imageUrl: typeof item.imageUrl === 'string' && item.imageUrl.trim() ? item.imageUrl : undefined,
            recommended: item.recommended === true,
            popular: item.popular === true,
            new: item.new === true,
            category: { id: String(category?._id || ''), names: normalizeNames(category?.names || { vi: category?.name || '' }), sortOrder: Number.isFinite(category?.sortOrder) ? category.sortOrder : 0 },
            price: basePrice,
            variants: normalizeOptions(item.variants, 'variant'),
            noteOptions: normalizeOptions(item.noteOptions, 'note'),
            type: item.type || 'product',
            components: (item.components || []).map((component: any, index: number) => ({ componentId: `${component.itemId?._id || component.itemId}-${index}`, itemId: String(component.itemId?._id || component.itemId), quantity: Number(component.quantity) || 1, names: normalizeNames(component.itemId?.names), noteOptions: normalizeOptions(component.itemId?.noteOptions, 'note') })),
            addons: (item.addons || []).flatMap((addon: any) => {
                const storeAddon = storeAddonById.get(String(addon._id))
                return storeAddon ? [{ id: String(addon._id), names: normalizeNames(addon.names || { vi: addon.name || '' }), priceExtra: Number(storeAddon.priceExtra) }] : []
            }),
        }]
    })
}
