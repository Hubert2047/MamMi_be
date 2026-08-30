import type { Request, Response } from 'express'
import Item from '../models/item.js'
import type { LocalizedOption, OptionGroup } from '../models/item.js'
import mongoose from 'mongoose'
import StoreItem from '../models/store-item.js'
import StoreAddon from '../models/store-addon.js'
import type { AuthRequest } from '../middlewares/auth.js'
import Store from '../models/store.js'
import { Role } from '../constants/role.js'
import { nextStoreMidnight } from '../utils/storeAvailability.js'
import { emitCatalogEventToStores, emitStoreEvent } from '../realtime.js'
import { deleteCloudinaryImage } from '../services/cloudinary.js'

const optionLabel = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'option'
const normalizeNames = (value: unknown) => {
    const names = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const normalized = {
        vi: typeof names.vi === 'string' ? names.vi.trim() : '',
        en: typeof names.en === 'string' ? names.en.trim() : '',
        'zh-TW': typeof names['zh-TW'] === 'string' ? names['zh-TW'].trim() : '',
    }
    return normalized.vi || normalized.en || normalized['zh-TW'] ? normalized : null
}
const normalizeOptions = (options: unknown, prefix: string): LocalizedOption[] => (Array.isArray(options) ? options : []).map((option: any, index) => {
    if (typeof option === 'string') {
        return { id: `${prefix}-${index + 1}-${optionLabel(option)}`, names: { vi: option, en: option, 'zh-TW': option } }
    }
    return {
        id: option.id || `${prefix}-${index + 1}`,
        names: {
            vi: option.names?.vi || '',
            en: option.names?.en || '',
            'zh-TW': option.names?.['zh-TW'] || '',
        },
    }
})
const normalizeOptionGroups = (groups: unknown): OptionGroup[] => (Array.isArray(groups) ? groups : []).map((group: any, index) => ({
    id: typeof group?.id === 'string' && group.id.trim() ? group.id.trim() : `group-${index + 1}`,
    names: normalizeNames(group?.names) || { vi: '', en: '', 'zh-TW': '' },
    selection: (group?.selection === 'multiple' ? 'multiple' : 'single') as 'single' | 'multiple',
    required: group?.required === true,
    ...(typeof group?.defaultOptionId === 'string' && group.defaultOptionId.trim() ? { defaultOptionId: group.defaultOptionId.trim() } : {}),
    options: normalizeOptions(group?.options, `group-${index + 1}-option`),
})).filter((group) => group.names.vi || group.names.en || group.names['zh-TW'])
const normalizeComponents = (components: unknown) => (Array.isArray(components) ? components : []).map((component: any) => ({ itemId: component.itemId, quantity: Math.max(1, Number(component.quantity) || 1) }))
const normalizeAddonConfigs = (addonIds: unknown, configs: unknown) => {
    const ids = [...new Set((Array.isArray(addonIds) ? addonIds : []).map((addon: any) => String(typeof addon === 'string' ? addon : addon?.addonId || '')).filter((id) => mongoose.isValidObjectId(id)))]
    const configByAddonId = new Map((Array.isArray(configs) ? configs : []).map((config: any) => {
        const addonId = String(config?.addonId || '')
        const maxQuantity = config?.maxQuantity === null ? null : Math.max(1, Math.floor(Number(config?.maxQuantity) || 1))
        return [addonId, maxQuantity] as const
    }))
    return ids.map((addonId) => ({ addonId, maxQuantity: configByAddonId.has(addonId) ? configByAddonId.get(addonId)! : 1 }))
}

const toCatalogItem = (item: any, language: string) => ({
    ...item,
    type: item.type || 'product',
    names: normalizeNames(item.names),
    description: normalizeNames(item.description),
    variants: normalizeOptions(item.variants, 'variant'),
    noteOptions: normalizeOptions(item.noteOptions, 'note'),
    optionGroups: normalizeOptionGroups(item.optionGroups),
    name: item.names?.[language] || item.names?.vi || Object.values(item.names || {})[0] || '',
    categoryName: item.categoryId?.names?.[language] || item.categoryId?.names?.vi || item.categoryId?.name || '',
    categorySortOrder: Number.isFinite(item.categoryId?.sortOrder) ? item.categoryId.sortOrder : 0,
    addons: (item.addons || []).map((addon: any) => { const config = (item.addonConfigs || []).find((entry: any) => String(entry.addonId) === String(addon._id)); return { ...addon, maxQuantity: config?.maxQuantity === null ? null : config?.maxQuantity ?? 1 } }),
})

const clearExpiredTemporaryAvailability = async (storeId: string) => {
    const result = await StoreItem.updateMany(
        { storeId, temporarilyUnavailable: true, temporarilyUnavailableUntil: { $lte: new Date() } },
        { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } },
    )
    if (result.modifiedCount > 0) emitStoreEvent(storeId, 'catalog.store-item.availability.updated', { reason: 'temporary-availability-expired' })
    const addonResult = await StoreAddon.updateMany(
        { storeId, temporarilyUnavailable: true, temporarilyUnavailableUntil: { $lte: new Date() } },
        { $set: { temporarilyUnavailable: false }, $unset: { temporarilyUnavailableUntil: 1 } },
    )
    if (addonResult.modifiedCount > 0) emitStoreEvent(storeId, 'catalog.store-addon.availability.updated', { reason: 'temporary-availability-expired' })
}

const getStoreTimeZone = async (storeId: string) => {
    const store = await Store.findById(storeId).select({ timezone: 1 }).lean()
    return store?.timezone || 'Asia/Taipei'
}

export const getCatalogItems = async (req: Request, res: Response) => {
    try {
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const items = await Item.find().populate('categoryId', 'names name sortOrder').populate('addons', 'names name').lean()
        res.json({ success: true, data: items.map((item) => toCatalogItem(item, language)) })
    } catch (error) { res.status(500).json({ success: false, message: 'Error fetching catalog items', error }) }
}

export const createCatalogItem = async (req: Request, res: Response) => {
    try {
        const names = normalizeNames(req.body.names)
        if (!names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const { price: _price, active: _active, addonConfigs: _addonConfigs, ...data } = req.body
        if (data.imageUrl !== undefined && typeof data.imageUrl !== 'string') return res.status(400).json({ success: false, message: 'Image URL must be a string' })
        if (data.imagePublicId !== undefined && typeof data.imagePublicId !== 'string') return res.status(400).json({ success: false, message: 'Image public ID must be a string' })
        const type = req.body.type === 'combo' ? 'combo' : 'product'
        const addonConfigs = type === 'combo' ? [] : normalizeAddonConfigs(req.body.addons, req.body.addonConfigs)
        const item = await Item.create({ ...data, type, addons: type === 'combo' ? [] : addonConfigs.map((config) => config.addonId), addonConfigs, components: type === 'combo' ? normalizeComponents(req.body.components) : [], names, ...(description ? { description } : {}), variants: normalizeOptions(req.body.variants, 'variant'), optionGroups: normalizeOptionGroups(req.body.optionGroups), noteOptions: normalizeOptions(req.body.noteOptions, 'note') })
        await emitCatalogEventToStores('catalog.item.updated', { itemId: String(item._id), changedFields: ['created'] })
        res.status(201).json({ success: true, data: item })
    } catch (error) { res.status(400).json({ success: false, message: 'Error creating catalog item', error }) }
}

export const updateCatalogItem = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const names = req.body.names === undefined ? undefined : normalizeNames(req.body.names)
        if (req.body.names !== undefined && !names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const { price: _price, active: _active, addonConfigs: _addonConfigs, ...data } = req.body
        if (data.imageUrl !== undefined && typeof data.imageUrl !== 'string') return res.status(400).json({ success: false, message: 'Image URL must be a string' })
        if (data.imagePublicId !== undefined && typeof data.imagePublicId !== 'string') return res.status(400).json({ success: false, message: 'Image public ID must be a string' })
        const nextType = req.body.type === 'combo' ? 'combo' : req.body.type === 'product' ? 'product' : undefined
        const addonConfigs = req.body.addons === undefined ? undefined : normalizeAddonConfigs(req.body.addons, req.body.addonConfigs)
        const update = { ...data, ...(nextType ? { type: nextType, ...(nextType === 'combo' ? { addons: [], addonConfigs: [], components: normalizeComponents(req.body.components) } : {}) } : {}), ...(req.body.type !== 'combo' && req.body.components ? { components: normalizeComponents(req.body.components) } : {}), ...(nextType !== 'combo' && addonConfigs ? { addons: addonConfigs.map((config) => config.addonId), addonConfigs } : {}), ...(names ? { names } : {}), ...(description ? { description } : {}), ...(req.body.variants ? { variants: normalizeOptions(req.body.variants, 'variant') } : {}), ...(req.body.optionGroups ? { optionGroups: normalizeOptionGroups(req.body.optionGroups) } : {}), ...(req.body.noteOptions ? { noteOptions: normalizeOptions(req.body.noteOptions, 'note') } : {}) }
        const previous = await Item.findById(id).select({ imagePublicId: 1 }).lean()
        const item = await Item.findByIdAndUpdate(id, update, { returnDocument: 'after', runValidators: true })
        if (!item) return res.status(404).json({ success: false, message: 'Catalog item not found' })
        if (previous?.imagePublicId && previous.imagePublicId !== item.imagePublicId) void deleteCloudinaryImage(previous.imagePublicId).catch((error) => console.error('Failed to delete old product image:', error))
        await emitCatalogEventToStores('catalog.item.updated', { itemId: id, changedFields: Object.keys(req.body) })
        res.json({ success: true, data: item })
    } catch (error) { res.status(400).json({ success: false, message: 'Error updating catalog item', error }) }
}

export const deleteCatalogItem = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const item = await Item.findById(id)
        if (!item) return res.status(404).json({ success: false, message: 'Catalog item not found' })
        await StoreItem.deleteMany({ itemId: id })
        await Item.findByIdAndDelete(id)
        if (item.imagePublicId) void deleteCloudinaryImage(item.imagePublicId).catch((error) => console.error('Failed to delete product image:', error))
        await emitCatalogEventToStores('catalog.item.updated', { itemId: id, changedFields: ['deleted'] })
        res.json({ success: true, data: item })
    } catch (error) { res.status(400).json({ success: false, message: 'Error deleting catalog item', error }) }
}

export const addStoreItem = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { itemId, price = {} } = req.body
        if (!await Item.exists({ _id: itemId })) return res.status(404).json({ success: false, message: 'Catalog item not found' })
        const storeItem = await StoreItem.findOneAndUpdate({ storeId, itemId }, { $set: { price }, $setOnInsert: { permanentlyActive: true, temporarilyUnavailable: false, temporarilyUnavailableUntil: null, visibility: { pos: true, qr: true, online: true }, addonDisplayMode: 'named' } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false })
        emitStoreEvent(storeId, 'catalog.store-item.price.updated', { itemId: String(itemId), changedFields: ['price'] })
        res.status(201).json({ success: true, data: storeItem })
    } catch (error) { res.status(400).json({ success: false, message: 'Error adding store item', error }) }
}

export const updateStoreItem = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const itemId = String(req.params.itemId)
        const authUser = (req as AuthRequest).user
        if (req.body.permanentlyActive !== undefined && ![Role.Admin, Role.SuperAdmin].includes(authUser.role)) {
            return res.status(403).json({ success: false, message: 'Only Admin or SuperAdmin can change permanent availability' })
        }
        await clearExpiredTemporaryAvailability(storeId)
        const set: Record<string, unknown> = {}
        if (req.body.price !== undefined) set.price = req.body.price
        if (req.body.permanentlyActive !== undefined) set.permanentlyActive = Boolean(req.body.permanentlyActive)
        if (req.body.visibility && typeof req.body.visibility === 'object') set.visibility = { pos: req.body.visibility.pos !== false, qr: req.body.visibility.qr !== false, online: req.body.visibility.online !== false }
        if (req.body.addonDisplayMode !== undefined) set.addonDisplayMode = req.body.addonDisplayMode === 'merged' ? 'merged' : 'named'
        if (req.body.temporarilyUnavailable !== undefined) {
            const unavailable = Boolean(req.body.temporarilyUnavailable)
            set.temporarilyUnavailable = unavailable
            if (unavailable) set.temporarilyUnavailableUntil = nextStoreMidnight(new Date(), await getStoreTimeZone(storeId))
        }
        const update: Record<string, unknown> = { $set: set }
        if (req.body.temporarilyUnavailable === false) update.$unset = { temporarilyUnavailableUntil: 1 }
        const storeItem = await StoreItem.findOneAndUpdate({ storeId, itemId }, update, { returnDocument: 'after', includeResultMetadata: false })
        if (!storeItem) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        const event = Object.prototype.hasOwnProperty.call(set, 'price') && Object.keys(set).length === 1
            ? 'catalog.store-item.price.updated'
            : 'catalog.store-item.availability.updated'
        emitStoreEvent(storeId, event, { itemId, changedFields: Object.keys(set) })
        res.json({ success: true, data: storeItem })
    } catch (error) { res.status(400).json({ success: false, message: 'Error updating store item', error }) }
}

export const updateTemporaryStoreItemAvailability = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const unavailable = Boolean(req.body.temporarilyUnavailable)
        await clearExpiredTemporaryAvailability(storeId)
        const update: Record<string, unknown> = { $set: { temporarilyUnavailable: unavailable } }
        if (unavailable) update.$set = { temporarilyUnavailable: true, temporarilyUnavailableUntil: nextStoreMidnight(new Date(), await getStoreTimeZone(storeId)) }
        else update.$unset = { temporarilyUnavailableUntil: 1 }
        const storeItem = await StoreItem.findOneAndUpdate({ storeId, itemId: String(req.params.itemId) }, update, { returnDocument: 'after', includeResultMetadata: false })
        if (!storeItem) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        emitStoreEvent(storeId, 'catalog.store-item.availability.updated', { itemId: String(req.params.itemId), changedFields: ['temporarilyUnavailable'] })
        res.json({ success: true, data: storeItem })
    } catch (error) { res.status(400).json({ success: false, message: 'Error updating temporary availability', error }) }
}

export const getItems = async (req: Request, res: Response) => {
    try {
        const { available } = req.query
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const storeId = (req as AuthRequest).user.storeId
        await clearExpiredTemporaryAvailability(storeId)
        const storeFilter: any = { storeId }
        if (available === 'true') {
            storeFilter.permanentlyActive = true
            storeFilter.temporarilyUnavailable = false
            storeFilter['visibility.pos'] = { $ne: false }
        }
        const storeItems = await StoreItem.find(storeFilter).populate({
            path: 'itemId',
            populate: [
                { path: 'categoryId', select: 'names name' },
                { path: 'addons', select: 'names name' },
            ],
        }).lean()
        const addonIds = storeItems.flatMap((storeItem: any) => storeItem.itemId?.addons?.map((addon: any) => addon._id) || [])
        const storeAddons = await StoreAddon.find({ storeId, addonId: { $in: addonIds }, permanentlyActive: { $ne: false } }).lean()
        const storeAddonById = new Map(storeAddons.map((addon: any) => [String(addon.addonId), addon]))

        const result = storeItems.filter((storeItem: any) => storeItem.itemId).map((storeItem: any) => {
            const item = storeItem.itemId
            return ({
            ...item,
            price: storeItem.price,
            permanentlyActive: storeItem.permanentlyActive !== false,
            visibility: { pos: storeItem.visibility?.pos !== false, qr: storeItem.visibility?.qr !== false, online: storeItem.visibility?.online !== false },
            addonDisplayMode: storeItem.addonDisplayMode === 'merged' ? 'merged' : 'named',
            temporarilyUnavailable: storeItem.temporarilyUnavailable === true,
            temporarilyUnavailableUntil: storeItem.temporarilyUnavailableUntil || null,
            variants: normalizeOptions(item.variants, 'variant'),
            noteOptions: normalizeOptions(item.noteOptions, 'note'),
            name: item.names?.[language] || item.names?.vi || Object.values(item.names || {})[0] || '',
            categoryName: item.categoryId?.names?.[language] || item.categoryId?.names?.vi || item.categoryId?.names?.en || item.categoryId?.names?.['zh-TW'] || item.categoryId?.name || '',
            addons: item.addons?.filter((addon: any) => storeAddonById.has(String(addon._id))).map((addon: any) => ({
                ...addon,
                maxQuantity: (() => { const config = (item.addonConfigs || []).find((entry: any) => String(entry.addonId) === String(addon._id)); return config?.maxQuantity === null ? null : config?.maxQuantity ?? 1 })(),
                priceExtra: storeAddonById.get(String(addon._id)).priceExtra,
                permanentlyActive: storeAddonById.get(String(addon._id)).permanentlyActive !== false,
                temporarilyUnavailable: storeAddonById.get(String(addon._id)).temporarilyUnavailable === true,
                name: addon.names?.[language] || addon.names?.vi || addon.names?.en || addon.names?.['zh-TW'] || addon.name || '',
            })),
            })
        })

        res.json({
            success: true,
            data: result,
        })
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching items',
            error,
        })
    }
}
export const removeSpecificAddons = async () => {
    try {
        const targetIds = ['69c5e9a2a98f910697a1956c', '69c5e9a3a98f910697a1956e'].map(
            (id) => new mongoose.Types.ObjectId(id),
        )

        const result = await Item.updateMany({ addons: { $in: targetIds } }, { $pull: { addons: { $in: targetIds }, addonConfigs: { addonId: { $in: targetIds } } } })

        console.log('Addons removed from items:', result.modifiedCount)
    } catch (error) {
        console.error('Error removing addons:', error)
    }
}
export const getItemById = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const storeId = (req as AuthRequest).user.storeId
        const storeItem = await StoreItem.findOne({ storeId, itemId: id }).lean()
        if (!storeItem) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        const item = await Item.findById(id).populate('categoryId')
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' })
        }
        res.json({ success: true, data: { ...item.toObject(), price: storeItem.price, permanentlyActive: storeItem.permanentlyActive, temporarilyUnavailable: storeItem.temporarilyUnavailable, temporarilyUnavailableUntil: storeItem.temporarilyUnavailableUntil || null } })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching item', error })
    }
}

export const createItem = async (req: Request, res: Response) => {
    try {
        const names = normalizeNames(req.body.names)
        if (!names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const { price = {}, ...itemData } = req.body
        const item = new Item({ ...itemData, names, ...(description ? { description } : {}), variants: normalizeOptions(req.body.variants, 'variant'), noteOptions: normalizeOptions(req.body.noteOptions, 'note') })
        await item.save()
        const storeId = (req as AuthRequest).user.storeId
        await StoreItem.create({ storeId, itemId: item._id, price, permanentlyActive: true, temporarilyUnavailable: false })
        await emitCatalogEventToStores('catalog.item.updated', { itemId: String(item._id), changedFields: ['created'] })
        emitStoreEvent(storeId, 'catalog.store-item.price.updated', { itemId: String(item._id), changedFields: ['price'] })
        res.status(201).json({ success: true, data: { ...item.toObject(), price, permanentlyActive: true, temporarilyUnavailable: false } })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error creating item', error })
    }
}

export const serverCreateItem = async (data: {
    names: Record<string, string>
    description?: Record<string, string>
    variants: LocalizedOption[] | string[] | null
    price: Map<string, number>
    addons: string[]
    categoryId: string
    noteOptions: LocalizedOption[] | string[]
}) => {
    try {
        const existing = await Item.findOne({ 'names.vi': data.names.vi })
        if (existing) {
            console.log(`Item "${data.names.vi}" đã tồn tại, bỏ qua.`)
            return null
        }
        const addonsIds = data.addons.map((id) => new mongoose.Types.ObjectId(id))
        const item = new Item({
            names: data.names,
            description: data.description,
            basePrice: data.price,
            variants: normalizeOptions(data.variants, 'variant'),
            addons: addonsIds,
            categoryId: new mongoose.Types.ObjectId(data.categoryId),
            noteOptions: normalizeOptions(data.noteOptions, 'note'),
        })
        await item.save()
        console.log(`Item "${data.names.vi}" đã được tạo thành công.`)
        return item
    } catch (error) {
        console.error('Create item failed:', error)
        return null
    }
}
export const serverUpdateItem = async (name: string, price: Map<string, number>) => {
  try {
    const updated = await Item.findOneAndUpdate(
      { 'names.vi': name },
      { $set: { price } },
      { returnDocument: 'after' }
    )

    if (!updated) {
      console.log(`Không tìm thấy item "${name}"`)
      return null
    }

    console.log(`Đã cập nhật item "${name}" thành công`)
    return updated
  } catch (error) {
    console.error('Update item failed:', error)
    return null
  }
}
export const updateItem = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const names = req.body.names === undefined ? undefined : normalizeNames(req.body.names)
        if (req.body.names !== undefined && !names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const { price, ...itemData } = req.body
        const updated = await Item.findByIdAndUpdate(id, { ...itemData, ...(names ? { names } : {}), ...(description ? { description } : req.body.description !== undefined ? { description: {} } : {}), ...(req.body.variants ? { variants: normalizeOptions(req.body.variants, 'variant') } : {}), ...(req.body.noteOptions ? { noteOptions: normalizeOptions(req.body.noteOptions, 'note') } : {}) }, { returnDocument: 'after', runValidators: true })
        const storeId = (req as AuthRequest).user.storeId
        const storeItem = await StoreItem.findOneAndUpdate({ storeId, itemId: id }, { $set: { ...(price !== undefined ? { price } : {}) } }, { returnDocument: 'after', includeResultMetadata: false })
        if (!updated || !storeItem) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        await emitCatalogEventToStores('catalog.item.updated', { itemId: id, changedFields: Object.keys(itemData) })
        if (price !== undefined) emitStoreEvent(storeId, 'catalog.store-item.price.updated', { itemId: id, changedFields: ['price'] })
        res.json({ success: true, data: { ...updated.toObject(), price: storeItem.price, permanentlyActive: storeItem.permanentlyActive, temporarilyUnavailable: storeItem.temporarilyUnavailable } })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error updating item', error })
    }
}

export const deleteItem = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const storeId = (req as AuthRequest).user.storeId
        const updated = await StoreItem.findOneAndUpdate({ storeId, itemId: id }, { $set: { permanentlyActive: false } })
        if (!updated) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        emitStoreEvent(storeId, 'catalog.store-item.availability.updated', { itemId: id, changedFields: ['permanentlyActive'] })
        res.json({ success: true, message: 'Item deleted' })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error deleting item', error })
    }
}
