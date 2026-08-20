import type { Request, Response } from 'express'
import Item from '../models/item.js'
import mongoose from 'mongoose'

export const getItems = async (req: Request, res: Response) => {
    try {
        const { active } = req.query
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const filter: any = {}
        if (active) {
            filter.active = active === 'true'
        }

        const items = await Item.find(filter)
            .populate('categoryId', 'name')
            .populate({
                path: 'addons',
                match: { active: true },
                select: 'name priceExtra',
            })
            .lean()

        const result = items.map((item: any) => ({
            ...item,
            name: item.names?.[language] || item.names?.vi || Object.values(item.names || {})[0] || '',
            categoryName: item.categoryId?.name,
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
        const item = new Item(req.body)
        await item.save()
        res.status(201).json({ success: true, data: item })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error creating item', error })
    }
}

export const serverCreateItem = async (data: {
    names: Record<string, string>
    variants: string[] | null
    price: Map<string, number>
    addons: string[]
    categoryId: string
    noteOptions: string[]
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
            basePrice: data.price,
            variants: data.variants,
            addons: addonsIds,
            categoryId: new mongoose.Types.ObjectId(data.categoryId),
            noteOptions: data.noteOptions,
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
        const updated = await Item.findByIdAndUpdate(id, req.body, { returnDocument: 'after' })
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
