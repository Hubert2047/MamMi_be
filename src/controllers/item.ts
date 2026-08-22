import type { Request, Response } from 'express'
import Item from '../models/item.js'
import type { LocalizedOption } from '../models/item.js'
import mongoose from 'mongoose'

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

export const getItems = async (req: Request, res: Response) => {
    try {
        const { active } = req.query
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const filter: any = {}
        if (active) {
            filter.active = active === 'true'
        }

        const items = await Item.find(filter)
            .populate('categoryId', 'names name')
            .populate({
                path: 'addons',
                match: { active: true },
                select: 'names name priceExtra',
            })
            .lean()

        const result = items.map((item: any) => ({
            ...item,
            variants: normalizeOptions(item.variants, 'variant'),
            noteOptions: normalizeOptions(item.noteOptions, 'note'),
            name: item.names?.[language] || item.names?.vi || Object.values(item.names || {})[0] || '',
            categoryName: item.categoryId?.names?.[language] || item.categoryId?.names?.vi || item.categoryId?.names?.en || item.categoryId?.names?.['zh-TW'] || item.categoryId?.name || '',
            addons: item.addons?.map((addon: any) => ({
                ...addon,
                name: addon.names?.[language] || addon.names?.vi || addon.names?.en || addon.names?.['zh-TW'] || addon.name || '',
            })),
        }))

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
        const { id } = req.params
        const item = await Item.findById(id).populate('categoryId')
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' })
        }
        res.json({ success: true, data: item })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching item', error })
    }
}

export const createItem = async (req: Request, res: Response) => {
    try {
        const names = normalizeNames(req.body.names)
        if (!names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const item = new Item({ ...req.body, names, ...(description ? { description } : {}), variants: normalizeOptions(req.body.variants, 'variant'), noteOptions: normalizeOptions(req.body.noteOptions, 'note') })
        await item.save()
        res.status(201).json({ success: true, data: item })
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
        const { id } = req.params
        const names = req.body.names === undefined ? undefined : normalizeNames(req.body.names)
        if (req.body.names !== undefined && !names) return res.status(400).json({ success: false, message: 'At least one product name is required' })
        const description = req.body.description === undefined ? undefined : normalizeNames(req.body.description)
        const updated = await Item.findByIdAndUpdate(id, { ...req.body, ...(names ? { names } : {}), ...(description ? { description } : req.body.description !== undefined ? { description: {} } : {}), ...(req.body.variants ? { variants: normalizeOptions(req.body.variants, 'variant') } : {}), ...(req.body.noteOptions ? { noteOptions: normalizeOptions(req.body.noteOptions, 'note') } : {}) }, { returnDocument: 'after', runValidators: true })
        res.json({ success: true, data: updated })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error updating item', error })
    }
}

export const deleteItem = async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        await Item.findByIdAndDelete(id)
        res.json({ success: true, message: 'Item deleted' })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error deleting item', error })
    }
}
