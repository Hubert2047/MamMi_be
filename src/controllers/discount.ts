import type { Request, Response } from 'express'
import Discount from '../models/discount.js'
import StoreDiscount from '../models/store-discount.js'
import User from '../models/user.js'
import Store from '../models/store.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { Role } from '../middlewares/auth.js'

type DiscountNames = { vi: string; en: string; 'zh-TW': string }

const getDiscountNames = (value: unknown, legacyName?: unknown): DiscountNames | null => {
    const names = value && typeof value === 'object' ? value as Partial<DiscountNames> : {}
    const legacy = typeof legacyName === 'string' ? legacyName.trim() : ''
    const normalized = {
        vi: typeof names.vi === 'string' ? names.vi.trim() : legacy,
        en: typeof names.en === 'string' ? names.en.trim() : legacy,
        'zh-TW': typeof names['zh-TW'] === 'string' ? names['zh-TW'].trim() : legacy,
    }
    return normalized.vi || normalized.en || normalized['zh-TW'] ? normalized : null
}

const validateAmount = (type: string, amount: unknown) => {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return 'Amount must be a non-negative number'
    if (type === 'percent' && amount > 100) return 'Percent cannot exceed 100'
    return null
}

const localizedName = (names: DiscountNames, language: string) => names[language as keyof DiscountNames] || names.vi || names.en || names['zh-TW']

const getAccessibleStoreIds = async (req: Request) => {
    const authUser = (req as AuthRequest).user
    if (authUser.role === Role.SuperAdmin) {
        const stores = await Store.find({ active: true }).select({ _id: 1 }).lean()
        return stores.map((store: any) => String(store._id))
    }
    const user = await User.findOne({ account: authUser.account }).select({ storeIds: 1 }).lean()
    return (user?.storeIds?.length ? user.storeIds : [authUser.storeId]).map(String)
}

const resolveStoreIds = async (req: Request, requested: unknown) => {
    const allowed = await getAccessibleStoreIds(req)
    const requestedIds = Array.isArray(requested) ? requested.map(String) : requested ? [String(requested)] : [(req as AuthRequest).user.storeId]
    if (requestedIds.some((id) => !allowed.includes(id))) {
        const error: any = new Error('You do not have access to one or more selected stores')
        error.statusCode = 403
        throw error
    }
    return requestedIds
}

const toResponse = (discount: any, config: any, language: string) => ({
    _id: discount._id,
    names: discount.names || { vi: discount.name || '', en: discount.name || '', 'zh-TW': discount.name || '' },
    name: localizedName(discount.names || { vi: discount.name || '', en: discount.name || '', 'zh-TW': discount.name || '' }, language),
    type: discount.type,
    note: discount.note || '',
    amount: config?.amount ?? 0,
    active: config?.active ?? false,
    startsAt: config?.startsAt || null,
    endsAt: config?.endsAt || null,
})

export const createDiscount = async (req: Request, res: Response) => {
    try {
        const names = getDiscountNames(req.body.names, req.body.name)
        if (!names) return res.status(400).json({ success: false, message: 'At least one discount name is required' })
        const type = req.body.type === 'value' ? 'value' : 'percent'
        const amount = Number(req.body.amount)
        const amountError = validateAmount(type, amount)
        if (amountError) return res.status(400).json({ success: false, message: amountError })
        const storeIds = await resolveStoreIds(req, req.body.storeIds)
        const discount = await Discount.create({ names, type, note: req.body.note })
        await StoreDiscount.insertMany(storeIds.map((storeId) => ({ storeId, discountId: discount._id, amount, active: req.body.active !== false, startsAt: req.body.startsAt || undefined, endsAt: req.body.endsAt || undefined })))
        const config = await StoreDiscount.findOne({ storeId: storeIds[0]!, discountId: discount._id }).lean()
        res.status(201).json({ success: true, data: toResponse(discount, config, String(req.query.lang || 'vi')) })
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message })
    }
}

export const serverCreateDiscount = async (name: string, amount: number, type: string, note: string, active: boolean) => {
    const names = getDiscountNames(undefined, name)
    if (!names) return
    return Discount.create({ names, type: type === 'value' ? 'value' : 'percent', note })
}

export const getDiscounts = async (req: Request, res: Response) => {
    try {
        const storeId = (await resolveStoreIds(req, req.query.storeId))[0]!
        const language = typeof req.query.lang === 'string' ? req.query.lang : 'vi'
        const [discounts, configs] = await Promise.all([
            Discount.find().sort({ createdAt: -1 }).lean(),
            StoreDiscount.find({ storeId }).lean(),
        ])
        const configByDiscount = new Map(configs.map((config: any) => [String(config.discountId), config]))
        res.json({ success: true, count: discounts.length, data: discounts.map((discount: any) => toResponse(discount, configByDiscount.get(String(discount._id)), language)) })
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message })
    }
}

export const updateDiscount = async (req: Request, res: Response) => {
    try {
        const names = req.body.names === undefined && req.body.name === undefined ? undefined : getDiscountNames(req.body.names, req.body.name)
        if ((req.body.names !== undefined || req.body.name !== undefined) && !names) return res.status(400).json({ success: false, message: 'At least one discount name is required' })
        const discount = await Discount.findByIdAndUpdate(req.params.id, { $set: { ...(names ? { names } : {}), ...(req.body.type ? { type: req.body.type } : {}), ...(req.body.note !== undefined ? { note: req.body.note } : {}) }, $unset: { name: 1 } }, { returnDocument: 'after', runValidators: true }).lean()
        if (!discount) return res.status(404).json({ success: false, message: 'Discount not found' })
        const storeId = (await resolveStoreIds(req, req.body.storeId || req.query.storeId))[0]!
        const existing = await StoreDiscount.findOne({ storeId, discountId: discount._id }).lean()
        const type = req.body.type || discount.type
        const amount = req.body.amount === undefined ? existing?.amount ?? 0 : Number(req.body.amount)
        const amountError = validateAmount(type, amount)
        if (amountError) return res.status(400).json({ success: false, message: amountError })
        const config = await StoreDiscount.findOneAndUpdate({ storeId, discountId: discount._id }, { $set: { amount, ...(req.body.active !== undefined ? { active: req.body.active } : {}), ...(req.body.startsAt !== undefined ? { startsAt: req.body.startsAt || null } : {}), ...(req.body.endsAt !== undefined ? { endsAt: req.body.endsAt || null } : {}) } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false }).lean()
        res.json({ success: true, data: toResponse(discount, config, String(req.query.lang || 'vi')) })
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message })
    }
}

export const updateStoreDiscount = async (req: Request, res: Response) => {
    try {
        const storeId = (await resolveStoreIds(req, req.body.storeId || req.query.storeId))[0]!
        const discount = await Discount.findById(req.params.id).lean()
        if (!discount) return res.status(404).json({ success: false, message: 'Discount not found' })
        const amount = Number(req.body.amount)
        const amountError = validateAmount(discount.type, amount)
        if (amountError) return res.status(400).json({ success: false, message: amountError })
        const config = await StoreDiscount.findOneAndUpdate({ storeId, discountId: discount._id }, { $set: { amount, ...(req.body.active !== undefined ? { active: req.body.active } : {}), ...(req.body.startsAt !== undefined ? { startsAt: req.body.startsAt || null } : {}), ...(req.body.endsAt !== undefined ? { endsAt: req.body.endsAt || null } : {}) } }, { upsert: true, returnDocument: 'after', includeResultMetadata: false }).lean()
        res.json({ success: true, data: toResponse(discount, config, String(req.query.lang || 'vi')) })
    } catch (error: any) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message })
    }
}

export const deleteDiscount = async (req: Request, res: Response) => {
    try {
        const discount = await Discount.findByIdAndDelete(req.params.id)
        if (!discount) return res.status(404).json({ success: false, message: 'Discount not found' })
        await StoreDiscount.deleteMany({ discountId: discount._id })
        res.json({ success: true, message: 'Deleted successfully' })
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message })
    }
}
