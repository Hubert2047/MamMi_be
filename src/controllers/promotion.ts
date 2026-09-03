import type { Request, Response } from 'express'
import Promotion from '../models/promotion.js'
import StorePromotion from '../models/store-promotion.js'
import type { AuthRequest } from '../middlewares/auth.js'
import { Role } from '../middlewares/auth.js'
import { emitCatalogEventToStores, emitStoreEvent } from '../realtime.js'
import { calculatePromotionPricing, isPromotionAvailableAt, type PricePromotion } from '../utils/promotionCalculations.js'
import { expireEndedPromotions } from '../services/promotionPricing.js'
import { deleteCloudinaryImage } from '../services/cloudinary.js'
import { isNonNegativeTwd, isValidPromotionAmount } from '../utils/money.js'

type Names = { vi: string; en: string; 'zh-TW': string }
const namesOf = (value: unknown): Names | null => {
    const names = value && typeof value === 'object' ? value as Partial<Names> : {}
    const normalized = { vi: String(names.vi || '').trim(), en: String(names.en || '').trim(), 'zh-TW': String(names['zh-TW'] || '').trim() }
    return normalized.vi || normalized.en || normalized['zh-TW'] ? normalized : null
}
const nameFor = (names: Names, language: string) => names[language as keyof Names] || names.vi || names.en || names['zh-TW']
const isValidRules = (rules: unknown) => Array.isArray(rules) && rules.length > 0 && rules.filter((rule: any) => rule?.target === 'order').length <= 1 && rules.every((rule: any) => ['order', 'product', 'addon', 'line'].includes(rule?.target) && ['percent', 'value'].includes(rule?.reward?.type) && isValidPromotionAmount(rule.reward.type, rule.reward.amount))
const isValidMinSubtotal = (value: unknown) => value === undefined || value === null || isNonNegativeTwd(value)
const hasValidWindow = (startsAt: unknown, endsAt: unknown) => !startsAt || !endsAt || new Date(String(startsAt)).getTime() <= new Date(String(endsAt)).getTime()
const isEditableStatus = (status: unknown): status is 'draft' | 'active' => status === 'draft' || status === 'active'
const responseFor = (promotion: any, config: any, language: string) => ({
    _id: String(promotion._id), names: promotion.names, name: nameFor(promotion.names, language), imageUrl: promotion.imageUrl || undefined, imagePublicId: promotion.imagePublicId || undefined, mode: promotion.mode,
    minSubtotal: promotion.minSubtotal, priority: promotion.priority, combinable: promotion.combinable,
    exclusiveGroup: promotion.exclusiveGroup || '', rules: promotion.rules, status: promotion.status,
    version: promotion.version, startsAt: promotion.startsAt || null, endsAt: promotion.endsAt || null,
    enabled: Boolean(config?.enabled), assigned: Boolean(config),
})

export const createPromotion = async (req: Request, res: Response) => {
    const names = namesOf(req.body.names)
    if (!names || !isValidRules(req.body.rules) || !isValidMinSubtotal(req.body.minSubtotal) || !req.body.startsAt || !req.body.endsAt || !hasValidWindow(req.body.startsAt, req.body.endsAt)) return res.status(400).json({ success: false, message: 'Promotion name, rules, start time, and end time are required' })
    const storeIds = Array.isArray(req.body.storeIds) ? req.body.storeIds : []
    const imageUrl = req.body.imageUrl === undefined ? undefined : String(req.body.imageUrl).trim()
    const imagePublicId = req.body.imagePublicId === undefined ? undefined : String(req.body.imagePublicId).trim()
    const promotion = await Promotion.create({ names, ...(imageUrl ? { imageUrl } : {}), ...(imagePublicId ? { imagePublicId } : {}), mode: req.body.mode === 'automatic' ? 'automatic' : 'manual', minSubtotal: req.body.minSubtotal || undefined, priority: Number(req.body.priority) || 0, combinable: req.body.combinable === true, exclusiveGroup: req.body.exclusiveGroup || undefined, rules: req.body.rules, status: req.body.status === 'active' ? 'active' : 'draft', startsAt: req.body.startsAt || undefined, endsAt: req.body.endsAt || undefined })
    if (storeIds.length) await StorePromotion.insertMany(storeIds.map((storeId: string) => ({ storeId, promotionId: promotion._id, enabled: req.body.enabled === true })))
    await emitCatalogEventToStores('catalog.changed', { entity: 'promotion', promotionId: String(promotion._id), changedFields: ['created'] }, storeIds)
    res.status(201).json({ success: true, data: responseFor(promotion, { enabled: req.body.enabled === true }, String(req.query.lang || 'vi')) })
}

export const getPromotions = async (req: Request, res: Response) => {
    await expireEndedPromotions()
    const storeId = String(req.query.storeId || (req as AuthRequest).user.storeId || '')
    const isSuperAdmin = (req as AuthRequest).user.role === Role.SuperAdmin
    const [promotions, storeConfigs, allConfigs] = await Promise.all([
        Promotion.find(isSuperAdmin ? {} : { status: 'active' }).sort({ createdAt: -1 }).lean(),
        StorePromotion.find({ storeId }).lean(),
        isSuperAdmin ? StorePromotion.find().lean() : Promise.resolve([]),
    ])
    const byPromotion = new Map(storeConfigs.map((config) => [String(config.promotionId), config]))
    const assignedStoreIds = new Map<string, string[]>()
    allConfigs.forEach((config) => assignedStoreIds.set(String(config.promotionId), [...(assignedStoreIds.get(String(config.promotionId)) || []), String(config.storeId)]))
    res.json({ success: true, data: promotions.map((promotion) => ({ ...responseFor(promotion, byPromotion.get(String(promotion._id)), String(req.query.lang || 'vi')), assignedStoreIds: assignedStoreIds.get(String(promotion._id)) || [] })) })
}

export const updatePromotion = async (req: Request, res: Response) => {
    const names = req.body.names === undefined ? undefined : namesOf(req.body.names)
    if (req.body.names !== undefined && !names) return res.status(400).json({ success: false, message: 'Promotion name is required' })
    if (req.body.rules !== undefined && !isValidRules(req.body.rules)) return res.status(400).json({ success: false, message: 'At least one valid rule is required' })
    if (!isValidMinSubtotal(req.body.minSubtotal)) return res.status(400).json({ success: false, message: 'Minimum subtotal must be a non-negative integer' })
    if (req.body.status !== undefined && !isEditableStatus(req.body.status)) return res.status(400).json({ success: false, message: 'Promotion status must be draft or active' })
    if (!hasValidWindow(req.body.startsAt, req.body.endsAt)) return res.status(400).json({ success: false, message: 'The end time must not precede the start time' })
    const update: Record<string, unknown> = {}
    for (const key of ['mode', 'minSubtotal', 'priority', 'combinable', 'exclusiveGroup', 'rules', 'status', 'startsAt', 'endsAt']) if (req.body[key] !== undefined) update[key] = req.body[key]
    if (names) update.names = names
    if (req.body.imageUrl !== undefined) update.imageUrl = String(req.body.imageUrl).trim()
    if (req.body.imagePublicId !== undefined) update.imagePublicId = String(req.body.imagePublicId).trim()
    const previous = await Promotion.findById(req.params.id).select({ imagePublicId: 1 }).lean()
    const promotion = await Promotion.findByIdAndUpdate(req.params.id, { $set: update, $inc: { version: 1 } }, { returnDocument: 'after', runValidators: true }).lean()
    if (!promotion) return res.status(404).json({ success: false, message: 'Promotion not found' })
    if (previous?.imagePublicId && previous.imagePublicId !== promotion.imagePublicId) void deleteCloudinaryImage(previous.imagePublicId).catch((error) => console.error('Failed to delete old promotion image:', error))
    if (Array.isArray(req.body.storeIds)) {
        const storeIds = req.body.storeIds.map(String)
        await StorePromotion.deleteMany({ promotionId: promotion._id, storeId: { $nin: storeIds } })
        if (storeIds.length) await StorePromotion.bulkWrite(storeIds.map((storeId: string) => ({ updateOne: { filter: { storeId, promotionId: promotion._id }, update: { $setOnInsert: { enabled: false } }, upsert: true } })))
    }
    const configs = await StorePromotion.find({ promotionId: promotion._id }).lean()
    await emitCatalogEventToStores('catalog.changed', { entity: 'promotion', promotionId: String(promotion._id), changedFields: ['definition'] }, configs.map((config) => String(config.storeId)))
    res.json({ success: true, data: responseFor(promotion, null, String(req.query.lang || 'vi')) })
}

export const updateStorePromotion = async (req: Request, res: Response) => {
    const storeId = String(req.body.storeId || (req as AuthRequest).user.storeId)
    const promotion = await Promotion.findById(req.params.id).lean()
    if (!promotion) return res.status(404).json({ success: false, message: 'Promotion not found' })
    const config = await StorePromotion.findOneAndUpdate({ storeId, promotionId: promotion._id }, { $set: { enabled: req.body.enabled === true } }, { returnDocument: 'after', includeResultMetadata: false }).lean()
    if (!config) return res.status(403).json({ success: false, message: 'This promotion is not assigned to the store' })
    emitStoreEvent(storeId, 'catalog.promotion.updated', { promotionId: String(promotion._id), changedFields: ['enabled'] })
    res.json({ success: true, data: responseFor(promotion, config, String(req.query.lang || 'vi')) })
}

export const deletePromotion = async (req: Request, res: Response) => {
    const promotion = await Promotion.findByIdAndDelete(req.params.id)
    if (!promotion) return res.status(404).json({ success: false, message: 'Promotion not found' })
    const configs = await StorePromotion.find({ promotionId: promotion._id }).lean()
    await StorePromotion.deleteMany({ promotionId: promotion._id })
    if (promotion.imagePublicId) void deleteCloudinaryImage(promotion.imagePublicId).catch((error) => console.error('Failed to delete promotion image:', error))
    await emitCatalogEventToStores('catalog.changed', { entity: 'promotion', promotionId: String(promotion._id), changedFields: ['deleted'] }, configs.map((config) => String(config.storeId)))
    res.json({ success: true })
}

export const previewPromotions = async (req: Request, res: Response) => {
    const storeId = (req as AuthRequest).user.storeId
    const now = new Date()
    await expireEndedPromotions(now)
    const configs = await StorePromotion.find({ storeId, enabled: true }).populate('promotionId').lean()
    const promotions: PricePromotion[] = configs.flatMap((config: any) => {
        const promotion = config.promotionId as any
        if (!promotion || !isPromotionAvailableAt(promotion, now)) return []
        const names = { vi: promotion.names.vi || '', en: promotion.names.en || '', 'zh-TW': promotion.names['zh-TW'] || '' }
        return [{ id: String(promotion._id), name: names.vi || names.en || names['zh-TW'], names, version: promotion.version, mode: promotion.mode, minSubtotal: promotion.minSubtotal, priority: promotion.priority, combinable: promotion.combinable, exclusiveGroup: promotion.exclusiveGroup, rules: promotion.rules.map((rule: any) => ({ target: rule.target, productIds: rule.productIds.map(String), addonIds: rule.addonIds.map(String), reward: rule.reward })) }]
    })
    const items = Array.isArray(req.body.items) ? req.body.items : []
    const selected = Array.isArray(req.body.selectedPromotionIds) ? req.body.selectedPromotionIds.map(String) : []
    if (selected.length > 1) return res.status(400).json({ success: false, code: 'MANUAL_PROMOTION_LIMIT', message: 'Only one manual promotion may be selected' })
    res.json({ success: true, data: calculatePromotionPricing(items, promotions, selected) })
}

export const promotionRoles = { create: [Role.SuperAdmin], update: [Role.SuperAdmin], store: [Role.Admin, Role.SuperAdmin] }
