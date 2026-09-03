import Item from '../models/item.js'
import StoreAddon from '../models/store-addon.js'
import StoreItem from '../models/store-item.js'
import type { PromotionOrderItem } from '../utils/promotionCalculations.js'

type OrderType = 'dine_in' | 'takeaway' | 'uber' | 'foodpanda'

const displayName = (value: any) => value?.names?.vi || value?.names?.en || value?.names?.['zh-TW'] || value?.name || ''
const priceForOrderType = (type: OrderType, price: any) => type === 'uber' ? price?.uber : type === 'foodpanda' ? price?.foodpanda : price?.base

/** Builds order items from server catalog data. Client-supplied prices/names are never used for pricing. */
export async function normalizeOrderItemsForPricing(storeId: string, type: OrderType, rawItems: any[]): Promise<PromotionOrderItem[]> {
    const itemIds = [...new Set(rawItems.map((item) => String(item.id)))]
    const [storeItems, catalogItems] = await Promise.all([
        StoreItem.find({ storeId, itemId: { $in: itemIds } }).select({ itemId: 1, price: 1, addonDisplayMode: 1 }).lean(),
        Item.find({ _id: { $in: itemIds } }).select('names variants noteOptions optionGroups addons addonConfigs').populate('addons', 'names name').lean(),
    ])
    const addonIds = [...new Set(rawItems.flatMap((item) => Array.isArray(item.addons) ? item.addons.map((addon: any) => String(addon.id)) : []))]
    const storeAddons = addonIds.length
        ? await StoreAddon.find({ storeId, addonId: { $in: addonIds }, permanentlyActive: { $ne: false }, temporarilyUnavailable: false }).select({ addonId: 1, priceExtra: 1 }).lean()
        : []
    const storeItemById = new Map(storeItems.map((entry: any) => [String(entry.itemId), entry]))
    const catalogById = new Map(catalogItems.map((entry: any) => [String(entry._id), entry]))
    const storeAddonById = new Map(storeAddons.map((entry: any) => [String(entry.addonId), entry]))

    const optionName = (option: any) => typeof option === 'string' ? option : displayName(option) || option?.id || ''
    return rawItems.map((item) => {
        const itemId = String(item.id)
        const storeItem = storeItemById.get(itemId)
        const catalogItem = catalogById.get(itemId)
        const basePrice = Number(priceForOrderType(type, storeItem?.price))
        const quantity = Number(item.quantity)
        if (!storeItem || !catalogItem || !Number.isFinite(basePrice) || basePrice < 0) throw new Error('ITEM_NOT_AVAILABLE')
        if (!Number.isInteger(quantity) || quantity < 1) throw new Error('ITEM_QUANTITY_INVALID')

        const selectedVariant = catalogItem.variants?.find((option: any) => option?.id === item.variant) || item.variant
        const selectedNoteOptions = (item.noteOptions || []).map((selectedOption: any) => catalogItem.noteOptions?.find((option: any) => option?.id === selectedOption) || selectedOption)
        const requestedSelections = Array.isArray(item.optionSelections) ? item.optionSelections : []
        const optionSelections = requestedSelections.map((selection: any) => {
            const group = (catalogItem.optionGroups || []).find((candidate: any) => candidate.id === selection?.groupId)
            const option = group?.options?.find((candidate: any) => candidate.id === selection?.optionId)
            if (!group || !option) throw new Error('INVALID_OPTION')
            return { groupId: group.id, optionId: option.id, name: optionName(option) }
        })
        for (const group of catalogItem.optionGroups || []) {
            if (group.required && !optionSelections.some((selection: any) => selection.groupId === group.id)) throw new Error('INVALID_OPTION')
            if (group.selection === 'single' && optionSelections.filter((selection: any) => selection.groupId === group.id).length > 1) throw new Error('INVALID_OPTION')
        }

        const selectedAddons = (item.addons || []).map((addon: any) => {
            const catalogAddon = catalogItem.addons?.find((candidate: any) => String(candidate?._id) === String(addon.id))
            const storeAddon = storeAddonById.get(String(addon.id))
            const config = (catalogItem.addonConfigs || []).find((entry: any) => String(entry.addonId) === String(addon.id))
            const maxQuantity = config?.maxQuantity === null ? null : config?.maxQuantity ?? 1
            const amount = Math.max(1, Math.floor(Number(addon.amount) || 1))
            const priceExtra = Number(storeAddon?.priceExtra)
            if (!catalogAddon || !storeAddon || !Number.isFinite(priceExtra) || priceExtra < 0 || (maxQuantity !== null && amount > maxQuantity)) throw new Error('ADDON_NOT_AVAILABLE')
            return { id: String(addon.id), name: displayName(catalogAddon), priceExtra, amount, printName: displayName(catalogAddon) }
        })
        if (new Set(selectedAddons.map((addon: any) => addon.id)).size !== selectedAddons.length) throw new Error('ADDON_QUANTITY_INVALID')
        const printNoteOptions = selectedNoteOptions.map((selectedOption: any) => optionName(selectedOption))
        return {
            id: item.id,
            itemId: item.itemId,
            name: displayName(catalogItem),
            quantity,
            basePrice,
            variant: optionName(selectedVariant),
            addons: selectedAddons,
            addonDisplayMode: storeItem.addonDisplayMode === 'merged' ? 'merged' : 'named',
            noteOptions: printNoteOptions,
            note: item.note,
            printName: displayName(catalogItem),
            printVariant: optionName(selectedVariant),
            printAddons: selectedAddons,
            printNoteOptions,
            optionSelections,
            componentSelections: Array.isArray(item.componentSelections) ? item.componentSelections : [],
        }
    })
}
