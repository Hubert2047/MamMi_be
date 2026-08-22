import type { Request, Response } from 'express'
import Category from '../models/category.js'

export type CategoryNames = { vi: string; en: string; 'zh-TW': string }

const getCategoryNames = (value: unknown): CategoryNames | null => {
    if (!value || typeof value !== 'object') return null
    const names = value as Partial<CategoryNames>
    const normalized = {
        vi: typeof names.vi === 'string' ? names.vi.trim() : '',
        en: typeof names.en === 'string' ? names.en.trim() : '',
        'zh-TW': typeof names['zh-TW'] === 'string' ? names['zh-TW'].trim() : '',
    }
    return normalized.vi || normalized.en || normalized['zh-TW'] ? normalized : null
}

const toResponseCategory = (category: any) => {
    const legacyName = category.name || ''
    return {
        ...category,
        names: category.names || { vi: legacyName, en: legacyName, 'zh-TW': legacyName },
    }
}

const duplicateCategoryError = (error: any) => {
    const fields = Object.keys(error?.keyPattern || {}).join(', ')
    return fields ? `A category with the same value already exists (${fields})` : 'A category with the same name already exists'
}

export const getCategories = async (req: Request, res: Response) => {
    try {
        const categories = await Category.find().sort({ 'names.vi': 1, name: 1 }).lean()
        res.json({ success: true, data: categories.map(toResponseCategory) })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching categories', error })
    }
}

export const getCategoryById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        const category = await Category.findById(id)
        if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' })
        }
        res.json({ success: true, data: category })
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error fetching category', error })
    }
}

export const createCategory = async (req: Request, res: Response) => {
    try {
        const names = getCategoryNames(req.body.names)
        if (!names) return res.status(400).json({ success: false, message: 'All category names are required' })
        const existing = await Category.findOne({ $or: [{ 'names.vi': names.vi }, { name: names.vi }] })
        if (existing) {
            return res.status(400).json({ success: false, message: 'Category already exists' })
        }
        const category = new Category({ names })
        await category.save()
        res.status(201).json({ success: true, data: category })
    } catch (error: any) {
        if (error?.code === 11000) return res.status(409).json({ success: false, message: duplicateCategoryError(error) })
        res.status(400).json({ success: false, message: 'Error creating category', error })
    }
}
export const serverCreateCategory = async (names: CategoryNames) => {
    try {
        const existing = await Category.findOne({ $or: [{ 'names.vi': names.vi }, { name: names.vi }] })
        if (existing) return
        const category = new Category({ names })
        await category.save()
    } catch (error) {}
}
export const updateCategory = async (req: any, res: any) => {
    try {
        const { id } = req.params
        const names = getCategoryNames(req.body.names)
        if (!names) return res.status(400).json({ success: false, message: 'All category names are required' })
        const updated = await Category.findByIdAndUpdate(id, { $set: { names }, $unset: { name: 1 } }, { returnDocument: 'after', runValidators: true })
        res.json({ success: true, data: updated })
    } catch (error: any) {
        if (error?.code === 11000) return res.status(409).json({ success: false, message: duplicateCategoryError(error) })
        res.status(400).json({ success: false, message: 'Error updating category', error })
    }
}

export const deleteCategory = async (req: Request, res: Response) => {
    try {
        const { id } = req.params
        await Category.findByIdAndDelete(id)
        res.json({ success: true, message: 'Category deleted' })
    } catch (error) {
        res.status(400).json({ success: false, message: 'Error deleting category', error })
    }
}
