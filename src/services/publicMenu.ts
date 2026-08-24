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
            { path: 'categoryId', select: 'names name' },
            { path: 'addons', select: 'names name' },
        ],
    }).lean()
    const addonIds = storeItems.flatMap((storeItem: any) => storeItem.itemId?.addons?.map((addon: any) => addon._id) || [])
    const storeAddons = await StoreAddon.find({ storeId, addonId: { $in: addonIds }, permanentlyActive: true, temporarilyUnavailable: false }).lean()
    const storeAddonById = new Map(storeAddons.map((addon: any) => [String(addon.addonId), addon]))

    return storeItems.flatMap((storeItem: any) => {
        const item = storeItem.itemId
        if (!item) return []
        const basePrice = Number(storeItem.price?.base ?? 0)
        if (!Number.isFinite(basePrice)) return []
        const category = item.categoryId
        return [{
            id: String(item._id),
            names: normalizeNames(item.names),
            description: normalizeNames(item.description),
            category: { id: String(category?._id || ''), names: normalizeNames(category?.names || { vi: category?.name || '' }) },
            price: basePrice,
            variants: normalizeOptions(item.variants, 'variant'),
            noteOptions: normalizeOptions(item.noteOptions, 'note'),
            addons: (item.addons || []).flatMap((addon: any) => {
                const storeAddon = storeAddonById.get(String(addon._id))
                return storeAddon ? [{ id: String(addon._id), names: normalizeNames(addon.names || { vi: addon.name || '' }), priceExtra: Number(storeAddon.priceExtra) }] : []
            }),
        }]
    })
}
