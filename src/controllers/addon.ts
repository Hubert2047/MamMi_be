import type { Request, Response } from 'express'
import AddonModel from '../models/addon.js'
import StoreAddon from '../models/store-addon.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { emitCatalogEventToStores, emitStoreEvent } from '../realtime.js'

export type AddonNames = { vi: string; en: string; 'zh-TW': string }

const getAddonNames = (value: unknown, legacyName?: unknown): AddonNames | null => {
    const names = value && typeof value === 'object' ? value as Partial<AddonNames> : {}
    const legacy = typeof legacyName === 'string' ? legacyName.trim() : ''
    const normalized = {
        vi: typeof names.vi === 'string' ? names.vi.trim() : legacy,
        en: typeof names.en === 'string' ? names.en.trim() : legacy,
        'zh-TW': typeof names['zh-TW'] === 'string' ? names['zh-TW'].trim() : legacy,
    }
    return normalized.vi || normalized.en || normalized['zh-TW'] ? normalized : null
}

const toResponseAddon = (addon: any, language = 'vi') => {
    const legacyName = addon.name || ''
    const names = addon.names || { vi: legacyName, en: legacyName, 'zh-TW': legacyName }
    return { ...addon, names, name: names[language] || names.vi || names.en || names['zh-TW'] || legacyName }
}

export const getStoreAddons = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const storeAddons = await StoreAddon.find({ storeId }).populate('addonId').lean()
        res.json(storeAddons.filter((entry: any) => entry.addonId).map((entry: any) => ({ ...toResponseAddon(entry.addonId, language), priceExtra: entry.priceExtra, active: entry.active })))
    } catch (err) { res.status(500).json({ message: 'Server error', error: err }) }
}

export const addStoreAddon = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const { addonId, priceExtra = 0, active = true } = req.body
        if (!await AddonModel.exists({ _id: addonId })) return res.status(404).json({ message: 'Addon not found' })
        const storeAddon = await StoreAddon.findOneAndUpdate({ storeId, addonId }, { $set: { priceExtra, active } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false })
        emitStoreEvent(storeId, 'catalog.store-addon.updated', { addonId: String(addonId), changedFields: ['priceExtra', 'active'] })
        res.status(201).json(storeAddon)
    } catch (err) { res.status(400).json({ message: 'Invalid data', error: err }) }
}

export const updateStoreAddon = async (req: Request, res: Response) => {
    try {
        const storeId = (req as AuthRequest).user.storeId
        const addonId = String(req.params.addonId)
        const storeAddon = await StoreAddon.findOneAndUpdate({ storeId, addonId }, { $set: { ...(req.body.priceExtra !== undefined ? { priceExtra: Number(req.body.priceExtra) } : {}), ...(req.body.active !== undefined ? { active: req.body.active } : {}) } }, { returnDocument: 'after', includeResultMetadata: false })
        if (!storeAddon) return res.status(404).json({ message: 'Addon not found in this store' })
        emitStoreEvent(storeId, 'catalog.store-addon.updated', { addonId, changedFields: Object.keys(req.body) })
        res.json(storeAddon)
    } catch (err) { res.status(400).json({ message: 'Invalid data', error: err }) }
}

// Get all addons
export const getAllAddons = async (req: Request, res: Response) => {
    try {
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const addons = await AddonModel.find().sort({ 'names.vi': 1, name: 1 }).lean()
        res.json(addons.map((addon) => toResponseAddon(addon, language)))
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err })
    }
}

// Get single addon
export const getAddonById = async (req: Request, res: Response) => {
    try {
        const addon = await AddonModel.findById(req.params.id)
        if (!addon) return res.status(404).json({ message: 'Addon not found' })
        res.json(toResponseAddon(addon))
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err })
    }
}

// Create addon
export const createAddon = async (req: Request, res: Response) => {
    try {
        const names = getAddonNames(req.body.names, req.body.name)
        if (!names) return res.status(400).json({ message: 'At least one addon name is required' })
        const newAddon = new AddonModel({ names })
        const saved = await newAddon.save()
        await emitCatalogEventToStores('catalog.changed', { entity: 'addon', addonId: String(saved._id), changedFields: ['created'] })
        res.status(201).json(toResponseAddon(saved))
    } catch (err) {
        res.status(400).json({ message: 'Invalid data', error: err })
    }
}

export const serverCreateAddon = async (name: string) => {
    try {
        const names = getAddonNames(undefined, name)
        if (!names) return
        const newAddon = new AddonModel({ names })
        await newAddon.save()
    } catch (err) {}
}

// Update addon
export const updateAddon = async (req: any, res: any) => {
    try {
        const names = getAddonNames(req.body.names, req.body.name)
        if (!names) return res.status(400).json({ message: 'At least one addon name is required' })
        const updated = await AddonModel.findByIdAndUpdate(req.params.id, { $set: { names }, $unset: { name: 1, priceExtra: 1, active: 1 } }, { returnDocument: 'after', runValidators: true })
        if (!updated) return res.status(404).json({ message: 'Addon not found' })
        await emitCatalogEventToStores('catalog.changed', { entity: 'addon', addonId: String(req.params.id), changedFields: ['names'] })
        res.json(toResponseAddon(updated))
    } catch (err) {
        res.status(400).json({ message: 'Invalid data', error: err })
    }
}

// Delete addon
export const deleteAddon = async (req: Request, res: Response) => {
    try {
        const deleted = await AddonModel.findByIdAndDelete(req.params.id)
        if (!deleted) return res.status(404).json({ message: 'Addon not found' })
        await emitCatalogEventToStores('catalog.changed', { entity: 'addon', addonId: String(req.params.id), changedFields: ['deleted'] })
        res.json({ message: 'Addon deleted' })
    } catch (err) {
        res.status(500).json({ message: 'Server error', error: err })
    }
}
