import type { Request, Response } from 'express'
import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import Store from '../models/store.js'
import StoreTable from '../models/store-table.js'
import TableSession from '../models/table-session.js'
import { getPublicMenu } from '../services/publicMenu.js'
import GuestCart from '../models/guest-cart.js'
import PublicOrderRateLimit from '../models/public-order-rate-limit.js'
import Order from '../models/order.js'
import { applyPublicMenuPromotionDisplays, calculateStorePromotionPricing, getPublicCatalogPromotions } from '../services/promotionPricing.js'
import { allocateOrderSequence, getCurrentOrderPeriodId } from '../services/orderNumber.js'
import { createKitchenPrintJobs } from '../services/printJobs.js'
import { emitStoreEvent } from '../realtime.js'
import { createPublicOrderQuote, matchesPublicOrderQuote } from '../utils/publicOrderQuote.js'
import { normalizePublicOptionSelections } from '../utils/publicOrderOptions.js'

const CART_TTL_MS = 2 * 60 * 60 * 1000
const QR_ORDER_WINDOW_MS = 60 * 1000
const MAX_QR_ORDERS_PER_WINDOW = 8
const ONLINE_PHONE_WINDOW_MS = 30 * 60 * 1000
const MAX_ONLINE_ORDERS_PER_PHONE_WINDOW = 3
const onlineOrderingDisabled = () => process.env.ONLINE_ORDERING_ENABLED === 'false'
const rejectDisabledOnlineOrdering = (res: Response, source: unknown) => {
    if (source === 'online' && onlineOrderingDisabled()) {
        res.status(503).json({ success: false, code: 'ONLINE_ORDERING_DISABLED', message: 'Online ordering is not available yet' })
        return true
    }
    return false
}
const activeTableForToken = (token: string) => StoreTable.findOne({ qrToken: token, active: true }).lean()
const activeSessionForTable = (storeId: any, tableId: any) => TableSession.findOne({ storeId, tableId, status: 'active', expiresAt: { $gt: new Date() } }).lean()
const activeSessionForId = (storeId: any, sessionId: any) => TableSession.findOne({ _id: sessionId, storeId, status: 'active', expiresAt: { $gt: new Date() } }).lean()

const getQrContext = async (token: string) => {
    const table = await activeTableForToken(token)
    if (!table) return { table: null, session: null, code: 'QR_NOT_FOUND' as const }
    const session = await activeSessionForTable(table.storeId, table._id)
    if (session) return { table, session, code: null }
    const expired = await TableSession.findOneAndUpdate({ storeId: table.storeId, tableId: table._id, status: 'active', expiresAt: { $lte: new Date() } }, { $set: { status: 'expired' } }, { new: true }).lean()
    return { table, session: null, code: expired ? 'SESSION_EXPIRED' as const : 'SESSION_NOT_ACTIVE' as const }
}

const requireActiveCartSession = async (cart: { source?: string; storeId: unknown; tableSessionId?: unknown }) => {
    if ((cart.source || 'qr') !== 'qr') return true
    if (!cart.tableSessionId) return false
    return Boolean(await activeSessionForId(cart.storeId, cart.tableSessionId))
}

const reserveQrOrderSlot = async (storeId: any, sessionId: any) => {
    const now = new Date()
    const cutoff = new Date(now.getTime() - QR_ORDER_WINDOW_MS)
    const reset = await TableSession.findOneAndUpdate(
        { _id: sessionId, storeId, status: 'active', expiresAt: { $gt: now }, $or: [{ qrOrderWindowStartedAt: { $lte: cutoff } }, { qrOrderWindowStartedAt: { $exists: false } }] },
        { $set: { qrOrderWindowStartedAt: now, qrOrderWindowCount: 1 } },
        { new: true },
    ).lean()
    if (reset) return true
    return Boolean(await TableSession.findOneAndUpdate(
        { _id: sessionId, storeId, status: 'active', expiresAt: { $gt: now }, qrOrderWindowStartedAt: { $gt: cutoff }, qrOrderWindowCount: { $lt: MAX_QR_ORDERS_PER_WINDOW } },
        { $inc: { qrOrderWindowCount: 1 } },
        { new: true },
    ).lean())
}
const mainOnlineStore = () => Store.findOne({ isMain: true, active: true }).select({ name: 1 }).lean()

const normalizePhone = (phone: unknown) => typeof phone === 'string' ? phone.trim().replace(/[\s().-]/g, '') : ''
const reserveOnlinePhoneOrderSlot = async (storeId: any, phone: string) => {
    const now = new Date()
    const windowStartedAt = new Date(Math.floor(now.getTime() / ONLINE_PHONE_WINDOW_MS) * ONLINE_PHONE_WINDOW_MS)
    const phoneHash = createHash('sha256').update(phone).digest('hex')
    try {
        const limit = await PublicOrderRateLimit.findOneAndUpdate(
            { storeId, phoneHash, windowStartedAt, count: { $lt: MAX_ONLINE_ORDERS_PER_PHONE_WINDOW } },
            { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(windowStartedAt.getTime() + ONLINE_PHONE_WINDOW_MS) } },
            { upsert: true, returnDocument: 'after', includeResultMetadata: false },
        ).lean()
        return Boolean(limit)
    } catch (error: any) {
        if (error?.code === 11000) return false
        throw error
    }
}

const publicRealtimeTokenForStore = (storeId: string) => {
    const realtimeSecret = process.env.PUBLIC_ORDER_REALTIME_PRIVATE_KEY
    if (!realtimeSecret) throw new Error('PUBLIC_ORDER_REALTIME_PRIVATE_KEY is not configured')
    return jwt.sign({ scope: 'public-catalog', storeId }, realtimeSecret, { expiresIn: '15m' })
}

const verifyTurnstile = async (token: unknown) => {
    const secret = process.env.TURNSTILE_SECRET_KEY
    if (!secret) throw new Error('TURNSTILE_NOT_CONFIGURED')
    if (typeof token !== 'string' || !token.trim()) return false
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: token.trim() }),
    })
    if (!response.ok) return false
    const result = await response.json() as { success?: boolean; action?: string }
    return result.success === true && (!result.action || result.action === 'online_order')
}

const validGuestCartLines = (lines: unknown): lines is any[] => Array.isArray(lines) && lines.every((line: any) =>
    line?.itemId && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 99
    && Array.isArray(line.optionSelections || []) && Array.isArray(line.noteOptions) && Array.isArray(line.addonIds)
    && new Set(line.addonIds.map(String)).size === line.addonIds.length,
)

/** Rebuilds public-order items entirely from the current public catalog. */
const buildGuestOrderItems = async (storeId: string, source: unknown, lines: any[]) => {
    if (!validGuestCartLines(lines)) throw new Error('INVALID_CART_LINES')
    const menu = await getPublicMenu(storeId, source === 'online' ? 'online' : 'qr')
    const byId = new Map(menu.map((item: any) => [item.id, item]))
    return lines.map((line: any) => {
        const item: any = byId.get(line.itemId)
        if (!item) throw new Error('ITEM_NOT_AVAILABLE')
        if (item.unavailable) throw new Error('ITEM_TEMPORARILY_UNAVAILABLE')
        if (line.variant && !item.variants.some((option: any) => option.id === line.variant)) throw new Error('INVALID_OPTION')
        if (line.noteOptions.some((id: string) => !item.noteOptions.some((option: any) => option.id === id))) throw new Error('INVALID_OPTION')
        const optionSelections = normalizePublicOptionSelections(line.optionSelections, item.optionGroups || [])
        const addons = line.addonIds.map((id: string) => {
            const addon = item.addons.find((candidate: any) => candidate.id === id)
            if (!addon) throw new Error('ADDON_NOT_AVAILABLE')
            if (addon.unavailable) throw new Error('ADDON_TEMPORARILY_UNAVAILABLE')
            return { id, name: addon.names.vi || addon.names.en || '', priceExtra: addon.priceExtra, amount: 1 }
        })
        return {
            id: line.itemId, itemId: randomBytes(12).toString('hex'), name: item.names.vi || item.names.en || '', quantity: line.quantity,
            basePrice: item.price, variant: line.variant || '', addons, addonDisplayMode: item.addonDisplayMode === 'merged' ? 'merged' : 'named',
            optionSelections, noteOptions: line.noteOptions, note: String(line.note || '').slice(0, 300), componentSelections: Array.isArray(line.componentSelections) ? line.componentSelections : [],
        }
    })
}

export const getQrMenu = async (req: Request, res: Response) => {
    try {
        const { table, session, code } = await getQrContext(String(req.params.token))
        if (!table) return res.status(404).json({ success: false, code, message: 'QR code is not active' })
        if (!session) return res.status(409).json({ success: false, code, message: 'Table ordering session is not active', table: { code: table.code, name: table.name } })
        const store = await Store.findOne({ _id: table.storeId, active: true }).select({ name: 1 }).lean()
        if (!store) return res.status(404).json({ success: false, code: 'STORE_NOT_AVAILABLE', message: 'Store is not available' })
        const [items, promotions] = await Promise.all([getPublicMenu(String(table.storeId), 'qr'), getPublicCatalogPromotions(String(table.storeId))])
        const realtimeToken = publicRealtimeTokenForStore(String(table.storeId))
        const publicPromotions = promotions.map(({ id, names, descriptions, imageUrl, minSubtotal, startsAt, endsAt }: any) => ({ id, names, descriptions, imageUrl, minSubtotal, startsAt, endsAt }))
        res.json({ success: true, data: { store: { name: store.name }, table: { code: table.code, name: table.name }, items: applyPublicMenuPromotionDisplays(items, promotions), promotions: publicPromotions, realtimeToken } })
    } catch (error) {
        console.error('Error fetching QR menu:', error)
        res.status(500).json({ success: false, message: 'Unable to fetch menu' })
    }
}

export const createGuestCart = async (req: Request, res: Response) => {
    try {
        const { table, session, code } = await getQrContext(String(req.params.token))
        if (!table) return res.status(404).json({ success: false, code, message: 'QR code is not active' })
        if (!session) return res.status(409).json({ success: false, code, message: 'Table ordering session is not active' })
        const cart = await GuestCart.create({ storeId: table.storeId, source: 'qr', type: 'dine_in', table: table.code, tableSessionId: session._id, lines: [], expiresAt: new Date(Date.now() + CART_TTL_MS) })
        res.status(201).json({ success: true, data: { cartToken: cart.cartToken, table: cart.table, lines: cart.lines } })
    } catch { res.status(500).json({ success: false, message: 'Unable to create cart' }) }
}

export const getOnlineMenu = async (_req: Request, res: Response) => {
    try {
        const store = await mainOnlineStore()
        if (!store) return res.status(404).json({ success: false, code: 'STORE_NOT_AVAILABLE', message: 'Main store is not available' })
        const [items, promotions] = await Promise.all([getPublicMenu(String(store._id), 'online'), getPublicCatalogPromotions(String(store._id))])
        const realtimeToken = publicRealtimeTokenForStore(String(store._id))
        res.json({ success: true, data: { store: { name: store.name }, items: applyPublicMenuPromotionDisplays(items, promotions), realtimeToken } })
    } catch (error) {
        console.error('Error fetching online menu:', error)
        res.status(500).json({ success: false, message: 'Unable to fetch online menu' })
    }
}

export const createOnlineGuestCart = async (req: Request, res: Response) => {
    if (onlineOrderingDisabled()) return res.status(503).json({ success: false, code: 'ONLINE_ORDERING_DISABLED', message: 'Online ordering is not available yet' })
    const type = req.body?.type
    if (type !== 'dine_in' && type !== 'takeaway') return res.status(400).json({ success: false, code: 'INVALID_ORDER_TYPE', message: 'Order type must be dine-in or takeaway' })
    try {
        const store = await mainOnlineStore()
        if (!store) return res.status(404).json({ success: false, code: 'STORE_NOT_AVAILABLE', message: 'Main store is not available' })
        const cart = await GuestCart.create({ storeId: store._id, source: 'online', type, table: '', lines: [], expiresAt: new Date(Date.now() + CART_TTL_MS) })
        res.status(201).json({ success: true, data: { cartToken: cart.cartToken, type: cart.type, lines: cart.lines } })
    } catch { res.status(500).json({ success: false, message: 'Unable to create cart' }) }
}

export const getGuestCart = async (req: Request, res: Response) => {
    const cart = await GuestCart.findOne({ cartToken: String(req.params.cartToken) }).lean()
    if (!cart) return res.status(404).json({ success: false, code: 'CART_NOT_FOUND', message: 'Cart not found' })
    if (rejectDisabledOnlineOrdering(res, cart.source)) return
    if (!(await requireActiveCartSession(cart))) return res.status(409).json({ success: false, code: 'SESSION_EXPIRED', message: 'Table ordering session is not active' })
    res.json({ success: true, data: { cartToken: cart.cartToken, table: cart.table, lines: cart.lines, status: cart.status } })
}

export const updateGuestCart = async (req: Request, res: Response) => {
    const lines = Array.isArray(req.body.lines) ? req.body.lines : null
    if (!lines || !validGuestCartLines(lines)) return res.status(400).json({ success: false, code: 'INVALID_CART_LINES', message: 'Invalid cart lines' })
    const existing = await GuestCart.findOne({ cartToken: String(req.params.cartToken), status: 'draft' }).select({ source: 1, storeId: 1, tableSessionId: 1 }).lean()
    if (!existing) return res.status(409).json({ success: false, code: 'CART_LOCKED', message: 'Cart is unavailable' })
    if (rejectDisabledOnlineOrdering(res, existing.source)) return
    if (!(await requireActiveCartSession(existing))) return res.status(409).json({ success: false, code: 'SESSION_EXPIRED', message: 'Table ordering session is not active' })
    const update: any = { lines, expiresAt: new Date(Date.now() + CART_TTL_MS) }
    if (req.body.type !== undefined) {
        if (req.body.type !== 'dine_in' && req.body.type !== 'takeaway') return res.status(400).json({ success: false, code: 'INVALID_ORDER_TYPE', message: 'Order type must be dine-in or takeaway' })
        update.type = req.body.type
    }
    const cart = await GuestCart.findOneAndUpdate({ cartToken: String(req.params.cartToken), status: 'draft' }, { $set: update }, { returnDocument: 'after', includeResultMetadata: false })
    if (!cart) return res.status(409).json({ success: false, code: 'CART_LOCKED', message: 'Cart is unavailable' })
    res.json({ success: true, data: { cartToken: cart.cartToken, table: cart.table, type: cart.type, lines: cart.lines } })
}

export const previewGuestCart = async (req: Request, res: Response) => {
    const cart = await GuestCart.findOne({ cartToken: String(req.params.cartToken), status: 'draft' }).lean()
    if (!cart) return res.status(409).json({ success: false, code: 'CART_LOCKED', message: 'Cart is unavailable' })
    if (rejectDisabledOnlineOrdering(res, cart.source)) return
    if (!(await requireActiveCartSession(cart))) return res.status(409).json({ success: false, code: 'SESSION_EXPIRED', message: 'Table ordering session is not active' })
    const lines = Array.isArray(req.body?.lines) ? req.body.lines : cart.lines
    if (!validGuestCartLines(lines)) return res.status(400).json({ success: false, code: 'INVALID_CART_LINES', message: 'Invalid cart lines' })
    try {
        const items = await buildGuestOrderItems(String(cart.storeId), cart.source, lines)
        const pricing = await calculateStorePromotionPricing(String(cart.storeId), items)
        const quote = createPublicOrderQuote(cart.cartToken, String(cart.storeId), lines, pricing)
        res.json({ success: true, data: { items, pricing, ...pricing, ...quote } })
    } catch (error: any) {
        res.status(400).json({ success: false, code: error?.message || 'CART_PREVIEW_FAILED', message: 'Unable to preview cart' })
    }
}

export const confirmGuestCart = async (req: Request, res: Response) => {
    const draft = await GuestCart.findOne({ cartToken: String(req.params.cartToken), status: 'draft' }).select({ source: 1, storeId: 1, tableSessionId: 1 }).lean()
    if (!draft) return res.status(409).json({ success: false, code: 'CART_LOCKED', message: 'Cart was already confirmed or is unavailable' })
    if (rejectDisabledOnlineOrdering(res, draft.source)) return
    if (!(await requireActiveCartSession(draft))) return res.status(409).json({ success: false, code: 'SESSION_EXPIRED', message: 'Table ordering session is not active' })
    const cart = await GuestCart.findOneAndUpdate({ cartToken: String(req.params.cartToken), status: 'draft' }, { $set: { status: 'confirming' } }, { returnDocument: 'after', includeResultMetadata: false })
    if (!cart) return res.status(409).json({ success: false, code: 'CART_LOCKED', message: 'Cart was already confirmed or is unavailable' })
    try {
        if (!cart.lines.length) throw new Error('Cart is empty')
        const items = await buildGuestOrderItems(String(cart.storeId), cart.source, cart.lines)
        const pricing = await calculateStorePromotionPricing(String(cart.storeId), items)
        if (!matchesPublicOrderQuote(req.body?.quoteToken, cart.cartToken, String(cart.storeId), cart.lines, pricing)) {
            const quote = createPublicOrderQuote(cart.cartToken, String(cart.storeId), cart.lines, pricing)
            await GuestCart.updateOne({ _id: cart._id, status: 'confirming' }, { $set: { status: 'draft' } })
            return res.status(409).json({ success: false, code: 'ORDER_PRICING_CHANGED', message: 'Order pricing changed', data: { items, pricing, ...quote } })
        }
        const source = cart.source || 'qr'
        if (source === 'online') {
            if (!(await verifyTurnstile(req.body?.turnstileToken))) throw new Error('TURNSTILE_FAILED')
        }
        const customer = source === 'online' ? {
            name: typeof req.body?.customer?.name === 'string' ? req.body.customer.name.trim().slice(0, 120) : undefined,
            phone: normalizePhone(req.body?.customer?.phone).slice(0, 40) || undefined,
            address: typeof req.body?.customer?.address === 'string' ? req.body.customer.address.trim().slice(0, 300) : undefined,
        } : null
        if (source === 'online') {
            const phone = customer?.phone
            if (!phone) throw new Error('PHONE_REQUIRED')
            if (!(await reserveOnlinePhoneOrderSlot(cart.storeId, phone))) throw new Error('ONLINE_ORDER_RATE_LIMITED')
        }
        if (source === 'qr' && !(await reserveQrOrderSlot(cart.storeId, cart.tableSessionId))) throw new Error('QR_ORDER_RATE_LIMITED')
        const periodId = await getCurrentOrderPeriodId(String(cart.storeId)); const sequence = await allocateOrderSequence(String(cart.storeId), periodId)
        const pickupAt = typeof req.body?.pickupAt === 'string' && !Number.isNaN(Date.parse(req.body.pickupAt)) ? new Date(req.body.pickupAt) : new Date(Date.now() + 60 * 60 * 1000)
        const order = await new Order({ storeId: cart.storeId, number: sequence, sequence, periodId, items, totalPrice: pricing.total, appliedPromotions: pricing.appliedPromotions, status: 'pending', type: cart.type || 'dine_in', table: cart.table || '', tableSessionId: cart.tableSessionId, paymentMethod: 'cash', customer, source, pickupAt }).save()
        await GuestCart.updateOne({ _id: cart._id }, { $set: { status: 'confirmed', orderId: order._id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
        try { await createKitchenPrintJobs(order) } catch (error) { console.error('Failed to queue QR kitchen print jobs:', error) }
        emitStoreEvent(String(cart.storeId), 'order.created', { orderId: String(order._id), source })
        res.status(201).json({ success: true, data: { number: sequence, orderId: String(order._id), table: cart.table, type: cart.type, source, total: pricing.total } })
    } catch (error: any) {
        await GuestCart.updateOne({ _id: cart._id, status: 'confirming' }, { $set: { status: 'draft' } })
        const code = error?.message || 'ORDER_CONFIRM_FAILED'
        res.status(code === 'TURNSTILE_NOT_CONFIGURED' ? 500 : code === 'ONLINE_ORDER_RATE_LIMITED' || code === 'QR_ORDER_RATE_LIMITED' ? 429 : 400).json({ success: false, code, message: 'Unable to confirm order' })
    }
}
