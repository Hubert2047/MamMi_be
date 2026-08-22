import type { Request, Response } from 'express'
import Item from '../models/item.js'
import type { LocalizedOption } from '../models/item.js'
import mongoose from 'mongoose'
import StoreItem from '../models/store-item.js'
import StoreAddon from '../models/store-addon.js'
import type { AuthRequest } from '../middlewares/auth.js'

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

const toCatalogItem = (item: any, language: string) => ({
    ...item,
    variants: normalizeOptions(item.variants, 'variant'),
    noteOptions: normalizeOptions(item.noteOptions, 'note'),
    name: item.names?.[language] || item.names?.vi || Object.values(item.names || {})[0] || '',
    categoryName: item.categoryId?.names?.[language] || item.categoryId?.names?.vi || item.categoryId?.name || '',
})

export const getCatalogItems = async (req: Request, res: Response) => {
    try {
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const items = await Item.find().populate('categoryId', 'names name').populate('addons', 'names name priceExtra').lean()
        res.json({ success: true, data: items.map((item) => toCatalogItem(item, language)) })
    } catch (error) { res.status(500).json({ success: false, message: 'Error fetching catalog items', error }) }
}

export const createCatalogItem = async (req: Request, res: Response) => {
    try {
        const names = normalizeNames(req.body.names)
        if (!names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const { price: _price, active: _active, ...data } = req.body
        const item = await Item.create({ ...data, names, ...(description ? { description } : {}), variants: normalizeOptions(req.body.variants, 'variant'), noteOptions: normalizeOptions(req.body.noteOptions, 'note'), price: {} })
        res.status(201).json({ success: true, data: item })
    } catch (error) { res.status(400).json({ success: false, message: 'Error creating catalog item', error }) }
}

export const updateCatalogItem = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const names = req.body.names === undefined ? undefined : normalizeNames(req.body.names)
        if (req.body.names !== undefined && !names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const { price: _price, active: _active, ...data } = req.body
        const item = await Item.findByIdAndUpdate(id, { ...data, ...(names ? { names } : {}), ...(description ? { description } : {}), ...(req.body.variants ? { variants: normalizeOptions(req.body.variants, 'variant') } : {}), ...(req.body.noteOptions ? { noteOptions: normalizeOptions(req.body.noteOptions, 'note') } : {}) }, { returnDocument: 'after', runValidators: true })
        if (!item) return res.status(404).json({ success: false, message: 'Catalog item not found' })
        res.json({ success: true, data: item })
    } catch (error) { res.status(400).json({ success: false, message: 'Error updating catalog item', error }) }
}

export const deleteCatalogItem = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        if (await StoreItem.exists({ itemId: id })) return res.status(409).json({ success: false, message: 'Remove this product from every store menu before deleting it' })
        const item = await Item.findByIdAndDelete(id)
        if (!item) return res.status(404).json({ success: false, message: 'Catalog item not found' })
        res.json({ success: true, data: item })
    } catch (error) { res.status(400).json({ success: false, message: 'Error deleting catalog item', error }) }
}

export const addStoreItem = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { itemId, price = {}, active = true } = req.body
        if (!await Item.exists({ _id: itemId })) return res.status(404).json({ success: false, message: 'Catalog item not found' })
        const storeItem = await StoreItem.findOneAndUpdate({ storeId, itemId }, { $set: { price, active } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false })
        res.status(201).json({ success: true, data: storeItem })
    } catch (error) { res.status(400).json({ success: false, message: 'Error adding store item', error }) }
}

export const updateStoreItem = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const itemId = String(req.params.itemId)
        const storeItem = await StoreItem.findOneAndUpdate({ storeId, itemId }, { $set: { ...(req.body.price !== undefined ? { price: req.body.price } : {}), ...(req.body.active !== undefined ? { active: req.body.active } : {}) } }, { returnDocument: 'after', includeResultMetadata: false })
        if (!storeItem) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        res.json({ success: true, data: storeItem })
    } catch (error) { res.status(400).json({ success: false, message: 'Error updating store item', error }) }
}

export const getItems = async (req: Request, res: Response) => {
    try {
        const { active } = req.query
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const storeId = (req as AuthRequest).user.storeId
        const storeFilter: any = { storeId }
        if (active !== undefined) storeFilter.active = active === 'true'
        const storeItems = await StoreItem.find(storeFilter).populate({
            path: 'itemId',
            populate: [
                { path: 'categoryId', select: 'names name' },
                { path: 'addons', match: { active: true }, select: 'names name priceExtra' },
            ],
        }).lean()
        const addonIds = storeItems.flatMap((storeItem: any) => storeItem.itemId?.addons?.map((addon: any) => addon._id) || [])
        const storeAddons = await StoreAddon.find({ storeId, addonId: { $in: addonIds }, active: true }).lean()
        const storeAddonById = new Map(storeAddons.map((addon: any) => [String(addon.addonId), addon]))

        const result = storeItems.filter((storeItem: any) => storeItem.itemId).map((storeItem: any) => {
            const item = storeItem.itemId
            return ({
            ...item,
            price: storeItem.price,
            active: storeItem.active,
            variants: normalizeOptions(item.variants, 'variant'),
            noteOptions: normalizeOptions(item.noteOptions, 'note'),
            name: item.names?.[language] || item.names?.vi || Object.values(item.names || {})[0] || '',
            categoryName: item.categoryId?.names?.[language] || item.categoryId?.names?.vi || item.categoryId?.names?.en || item.categoryId?.names?.['zh-TW'] || item.categoryId?.name || '',
            addons: item.addons?.filter((addon: any) => storeAddonById.has(String(addon._id))).map((addon: any) => ({
                ...addon,
                priceExtra: storeAddonById.get(String(addon._id)).priceExtra,
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

        const result = await Item.updateMany({ addons: { $in: targetIds } }, { $pull: { addons: { $in: targetIds } } })

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
        res.json({ success: true, data: { ...item.toObject(), price: storeItem.price, active: storeItem.active } })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching item', error })
    }
}

export const createItem = async (req: Request, res: Response) => {
    try {
        const names = normalizeNames(req.body.names)
        if (!names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const { price = {}, active = true, ...itemData } = req.body
        const item = new Item({ ...itemData, names, ...(description ? { description } : {}), variants: normalizeOptions(req.body.variants, 'variant'), noteOptions: normalizeOptions(req.body.noteOptions, 'note'), price: {} })
        await item.save()
        const storeId = (req as AuthRequest).user.storeId
        await StoreItem.create({ storeId, itemId: item._id, price, active })
        res.status(201).json({ success: true, data: { ...item.toObject(), price, active } })
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
    active: boolean
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
            active: data.active,
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
        const { price, active, ...itemData } = req.body
        const updated = await Item.findByIdAndUpdate(id, { ...itemData, ...(names ? { names } : {}), ...(description ? { description } : req.body.description !== undefined ? { description: {} } : {}), ...(req.body.variants ? { variants: normalizeOptions(req.body.variants, 'variant') } : {}), ...(req.body.noteOptions ? { noteOptions: normalizeOptions(req.body.noteOptions, 'note') } : {}) }, { returnDocument: 'after', runValidators: true })
        const storeId = (req as AuthRequest).user.storeId
        const storeItem = await StoreItem.findOneAndUpdate({ storeId, itemId: id }, { $set: { ...(price !== undefined ? { price } : {}), ...(active !== undefined ? { active } : {}) } }, { returnDocument: 'after', includeResultMetadata: false })
        if (!updated || !storeItem) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        res.json({ success: true, data: { ...updated.toObject(), price: storeItem.price, active: storeItem.active } })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error updating item', error })
    }
}

export const deleteItem = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id)
        const storeId = (req as AuthRequest).user.storeId
        const updated = await StoreItem.findOneAndUpdate({ storeId, itemId: id }, { $set: { active: false } })
        if (!updated) return res.status(404).json({ success: false, message: 'Item not found in this store' })
        res.json({ success: true, message: 'Item deleted' })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error deleting item', error })
    }
}
