import type { Request, Response } from 'express'
import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import Store from '../models/store.js'
import StoreTable from '../models/store-table.js'
import { getPublicMenu } from '../services/publicMenu.js'
import GuestCart from '../models/guest-cart.js'
import Order from '../models/order.js'
import { calculateTotal } from '../utils/orderCalculations.js'
import { allocateOrderSequence, getCurrentOrderPeriodId } from '../services/orderNumber.js'
import { createKitchenPrintJobs } from '../services/printJobs.js'
import { emitStoreEvent } from '../realtime.js'

const CART_TTL_MS = 2 * 60 * 60 * 1000
const activeTableForToken = (token: string) => StoreTable.findOne({ qrToken: token, active: true }).lean()
const mainOnlineStore = () => Store.findOne({ isMain: true, active: true }).select({ name: 1 }).lean()

const publicRealtimeTokenForStore = (storeId: string) => {
    const realtimeSecret = process.env.PUBLIC_ORDER_REALTIME_PRIVATE_KEY
    if (!realtimeSecret) throw new Error('PUBLIC_ORDER_REALTIME_PRIVATE_KEY is not configured')
    return jwt.sign({ scope: 'public-catalog', storeId }, realtimeSecret, { expiresIn: '15m' })
}

export const getQrMenu = async (req: Request, res: Response) => {
    try {
        const table = await activeTableForToken(String(req.params.token))
        if (!table) return res.status(404).json({ success: false, code: 'QR_NOT_FOUND', message: 'QR code is not active' })
        const store = await Store.findOne({ _id: table.storeId, active: true }).select({ name: 1 }).lean()
        if (!store) return res.status(404).json({ success: false, code: 'STORE_NOT_AVAILABLE', message: 'Store is not available' })
        const items = await getPublicMenu(String(table.storeId))
        const realtimeToken = publicRealtimeTokenForStore(String(table.storeId))
        res.json({ success: true, data: { store: { name: store.name }, table: { code: table.code, name: table.name }, items, realtimeToken } })
    } catch (error) {
        console.error('Error fetching QR menu:', error)
        res.status(500).json({ success: false, message: 'Unable to fetch menu' })
    }
}

export const createGuestCart = async (req: Request, res: Response) => {
    try {
        const table = await activeTableForToken(String(req.params.token))
        if (!table) return res.status(404).json({ success: false, code: 'QR_NOT_FOUND', message: 'QR code is not active' })
        const cart = await GuestCart.create({ storeId: table.storeId, source: 'qr', type: 'dine_in', table: table.code, lines: [], expiresAt: new Date(Date.now() + CART_TTL_MS) })
        res.status(201).json({ success: true, data: { cartToken: cart.cartToken, table: cart.table, lines: cart.lines } })
    } catch { res.status(500).json({ success: false, message: 'Unable to create cart' }) }
}

export const getOnlineMenu = async (_req: Request, res: Response) => {
    try {
        const store = await mainOnlineStore()
        if (!store) return res.status(404).json({ success: false, code: 'STORE_NOT_AVAILABLE', message: 'Main store is not available' })
        const items = await getPublicMenu(String(store._id))
        const realtimeToken = publicRealtimeTokenForStore(String(store._id))
        res.json({ success: true, data: { store: { name: store.name }, items, realtimeToken } })
    } catch (error) {
        console.error('Error fetching online menu:', error)
        res.status(500).json({ success: false, message: 'Unable to fetch online menu' })
    }
}

export const createOnlineGuestCart = async (req: Request, res: Response) => {
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
    res.json({ success: true, data: { cartToken: cart.cartToken, table: cart.table, lines: cart.lines, status: cart.status } })
}

export const updateGuestCart = async (req: Request, res: Response) => {
    const lines = Array.isArray(req.body.lines) ? req.body.lines : null
    if (!lines || lines.some((line: any) => !line.itemId || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99 || !Array.isArray(line.noteOptions) || !Array.isArray(line.addonIds))) return res.status(400).json({ success: false, message: 'Invalid cart lines' })
    const update: any = { lines, expiresAt: new Date(Date.now() + CART_TTL_MS) }
    if (req.body.type !== undefined) {
        if (req.body.type !== 'dine_in' && req.body.type !== 'takeaway') return res.status(400).json({ success: false, code: 'INVALID_ORDER_TYPE', message: 'Order type must be dine-in or takeaway' })
        update.type = req.body.type
    }
    const cart = await GuestCart.findOneAndUpdate({ cartToken: String(req.params.cartToken), status: 'draft' }, { $set: update }, { returnDocument: 'after', includeResultMetadata: false })
    if (!cart) return res.status(409).json({ success: false, code: 'CART_LOCKED', message: 'Cart is unavailable' })
    res.json({ success: true, data: { cartToken: cart.cartToken, table: cart.table, type: cart.type, lines: cart.lines } })
}

export const confirmGuestCart = async (req: Request, res: Response) => {
    const cart = await GuestCart.findOneAndUpdate({ cartToken: String(req.params.cartToken), status: 'draft' }, { $set: { status: 'confirming' } }, { returnDocument: 'after', includeResultMetadata: false })
    if (!cart) return res.status(409).json({ success: false, code: 'CART_LOCKED', message: 'Cart was already confirmed or is unavailable' })
    try {
        if (!cart.lines.length) throw new Error('Cart is empty')
        const menu = await getPublicMenu(String(cart.storeId))
        const byId = new Map(menu.map((item: any) => [item.id, item]))
        const items = cart.lines.map((line) => {
            const item: any = byId.get(line.itemId)
            if (!item) throw new Error('ITEM_NOT_AVAILABLE')
            if (line.variant && !item.variants.some((option: any) => option.id === line.variant)) throw new Error('INVALID_OPTION')
            if (line.noteOptions.some((id) => !item.noteOptions.some((option: any) => option.id === id))) throw new Error('INVALID_OPTION')
            const addons = line.addonIds.map((id) => { const addon = item.addons.find((candidate: any) => candidate.id === id); if (!addon) throw new Error('ADDON_NOT_AVAILABLE'); return { id, name: addon.names.vi || addon.names.en || '', priceExtra: addon.priceExtra, amount: 1 } })
            return { id: line.itemId, itemId: randomBytes(12).toString('hex'), name: item.names.vi || item.names.en || '', quantity: line.quantity, basePrice: item.price, variant: line.variant || '', addons, noteOptions: line.noteOptions, note: String(line.note || '').slice(0, 300) }
        })
        const periodId = await getCurrentOrderPeriodId(String(cart.storeId)); const sequence = await allocateOrderSequence(String(cart.storeId), periodId)
        const source = cart.source || 'qr'
        const customer = source === 'online' ? {
            name: typeof req.body?.customer?.name === 'string' ? req.body.customer.name.trim().slice(0, 120) : undefined,
            phone: typeof req.body?.customer?.phone === 'string' ? req.body.customer.phone.trim().slice(0, 40) : undefined,
            address: typeof req.body?.customer?.address === 'string' ? req.body.customer.address.trim().slice(0, 300) : undefined,
        } : null
        if (source === 'online' && !customer?.phone) throw new Error('PHONE_REQUIRED')
        const order = await new Order({ storeId: cart.storeId, number: sequence, sequence, periodId, items, totalPrice: calculateTotal(items, null), status: 'pending', type: cart.type || 'dine_in', table: cart.table || '', paymentMethod: 'cash', customer, source }).save()
        await GuestCart.updateOne({ _id: cart._id }, { $set: { status: 'confirmed', orderId: order._id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } })
        try { await createKitchenPrintJobs(order) } catch (error) { console.error('Failed to queue QR kitchen print jobs:', error) }
        emitStoreEvent(String(cart.storeId), 'order.created', { orderId: String(order._id), source })
        res.status(201).json({ success: true, data: { number: sequence, orderId: String(order._id), table: cart.table, type: cart.type, source } })
    } catch (error: any) {
        await GuestCart.updateOne({ _id: cart._id, status: 'confirming' }, { $set: { status: 'draft' } })
        const code = error?.message || 'ORDER_CONFIRM_FAILED'
        res.status(400).json({ success: false, code, message: 'Unable to confirm order' })
    }
}
