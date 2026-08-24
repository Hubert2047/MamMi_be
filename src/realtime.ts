import type { Server as HttpServer } from 'node:http'
import jwt from 'jsonwebtoken'
import { Server as SocketIOServer, type Socket } from 'socket.io'
import Store from './models/store.js'
import User from './models/user.js'
import Order from './models/order.js'
import { Role } from './constants/role.js'

export type RealtimeChannel = 'catalog' | 'orders' | 'closing'
export type RealtimeClientType = 'pos' | 'admin' | 'customer' | 'order'
type StaffSocketUser = { account: string; role: Role; storeId: string; publicCatalogOnly?: false }
type PublicCatalogSocketUser = { storeId: string; publicCatalogOnly: true }
type SocketUser = StaffSocketUser | PublicCatalogSocketUser

const channelForEvent: Record<string, RealtimeChannel> = {
    'catalog.item.updated': 'catalog',
    'catalog.store-item.price.updated': 'catalog',
    'catalog.store-item.availability.updated': 'catalog',
    'catalog.store-addon.updated': 'catalog',
    'catalog.store-addon.availability.updated': 'catalog',
    'catalog.discount.updated': 'catalog',
    'catalog.changed': 'catalog',
    'inventory.item.updated': 'catalog',
    'inventory.unit.updated': 'catalog',
    'order.created': 'orders',
    'order.updated': 'orders',
    'order.cancelled': 'orders',
    'order.payment.updated': 'orders',
    'closing.created': 'closing',
    'closing.voided': 'closing',
}

export const roomForStore = (storeId: string) => `store:${storeId}`
export const roomForStoreChannel = (storeId: string, channel: RealtimeChannel) => `${roomForStore(storeId)}:${channel}`
export const roomForOrder = (orderId: string) => `order:${orderId}`

export const channelsForClient = (clientType: RealtimeClientType, role: Role): RealtimeChannel[] => {
    if (clientType === 'admin' || role === Role.SuperAdmin || role === Role.Admin) return ['catalog', 'orders', 'closing']
    if (clientType === 'customer') return ['catalog']
    return ['catalog', 'orders']
}

export const channelForRealtimeEvent = (event: string): RealtimeChannel | null => channelForEvent[event] ?? null
let io: SocketIOServer | null = null

const canAccessStore = async (account: string, role: Role, storeId: string) => {
    const store = await Store.findOne({ _id: storeId, active: true }).select({ _id: 1 }).lean()
    if (!store) return false
    if (role === Role.SuperAdmin) return true
    const user = await User.findOne({ account }).select({ storeIds: 1 }).lean()
    return Boolean(user?.storeIds?.some((id) => String(id) === storeId))
}

const authenticateSocket = async (socket: Socket) => {
    const publicToken = socket.handshake.auth?.publicToken
    if (typeof publicToken === 'string') {
        const secret = process.env.PUBLIC_ORDER_REALTIME_PRIVATE_KEY
        if (!secret) throw new Error('Public realtime is not configured')
        const payload = jwt.verify(publicToken, secret) as { scope?: string; storeId?: string }
        const storeId = String(payload.storeId || '')
        const store = await Store.findOne({ _id: storeId, active: true }).select({ _id: 1 }).lean()
        if (payload.scope !== 'public-catalog' || !store) throw new Error('Public catalog access denied')
        return { storeId, publicCatalogOnly: true } satisfies PublicCatalogSocketUser
    }
    const token = socket.handshake.auth?.token
    if (typeof token !== 'string') throw new Error('Missing access token')
    const payload = jwt.verify(token, process.env.ACCESS_TOKEN_PRIVATE_KEY as string) as { account: string; role: Role; storeId: string }
    const storeId = String(socket.handshake.auth?.storeId || payload.storeId || '')
    if (!storeId || !(await canAccessStore(payload.account, payload.role, storeId))) throw new Error('Store access denied')
    return { ...payload, storeId } satisfies StaffSocketUser
}

const clientTypeOf = (socket: Socket): RealtimeClientType => {
    const value = socket.handshake.auth?.clientType
    return value === 'admin' || value === 'customer' || value === 'order' ? value : 'pos'
}

const leaveStoreRooms = (socket: Socket, storeId: string) => {
    socket.leave(roomForStore(storeId))
    for (const channel of ['catalog', 'orders', 'closing'] as RealtimeChannel[]) socket.leave(roomForStoreChannel(storeId, channel))
}

const joinStoreRooms = (socket: Socket, storeId: string) => {
    const user = socket.data.user as SocketUser
    if (user.publicCatalogOnly) {
        socket.join(roomForStoreChannel(storeId, 'catalog'))
        return
    }
    const clientType = socket.data.clientType as RealtimeClientType
    socket.join(roomForStore(storeId))
    for (const channel of channelsForClient(clientType, user.role)) socket.join(roomForStoreChannel(storeId, channel))
}

export const initializeRealtime = (httpServer: HttpServer, origin: string | string[]) => {
    io = new SocketIOServer(httpServer, {
        cors: { origin, credentials: true },
        transports: ['websocket', 'polling'],
    })
    io.use(async (socket, next) => {
        try {
            socket.data.user = await authenticateSocket(socket)
            socket.data.clientType = clientTypeOf(socket)
            next()
        } catch {
            next(new Error('Unauthorized'))
        }
    })
    io.on('connection', (socket) => {
        const user = socket.data.user as SocketUser
        joinStoreRooms(socket, user.storeId)
        socket.on('store:join', async (storeId: string, acknowledge?: (result: { ok: boolean }) => void) => {
            try {
                const socketUser = socket.data.user as SocketUser
                if (socketUser.publicCatalogOnly) return acknowledge?.({ ok: false })
                const nextStoreId = String(storeId)
                if (!(await canAccessStore(socketUser.account, socketUser.role, nextStoreId))) return acknowledge?.({ ok: false })
                leaveStoreRooms(socket, socketUser.storeId)
                socketUser.storeId = nextStoreId
                joinStoreRooms(socket, nextStoreId)
                acknowledge?.({ ok: true })
            } catch {
                acknowledge?.({ ok: false })
            }
        })
        socket.on('order:join', async (orderId: string, acknowledge?: (result: { ok: boolean }) => void) => {
            try {
                const socketUser = socket.data.user as SocketUser
                if (socketUser.publicCatalogOnly) return acknowledge?.({ ok: false })
                const order = await Order.findOne({ _id: String(orderId), storeId: socketUser.storeId }).select({ _id: 1 }).lean()
                if (!order) return acknowledge?.({ ok: false })
                socket.join(roomForOrder(String(order._id)))
                acknowledge?.({ ok: true })
            } catch {
                acknowledge?.({ ok: false })
            }
        })
    })
    return io
}

export const emitStoreEvent = (storeId: string, event: string, payload: Record<string, unknown> = {}) => {
    const channel = channelForRealtimeEvent(event)
    if (!channel) return
    const message = { storeId, ...payload }
    io?.to(roomForStoreChannel(storeId, channel)).emit(event, message)
    if (channel === 'orders' && typeof payload.orderId === 'string') io?.to(roomForOrder(payload.orderId)).emit(event, message)
}

export const emitOrderEvent = (storeId: string, event: string, orderId: string, payload: Record<string, unknown> = {}) => {
    emitStoreEvent(storeId, event, { ...payload, orderId })
}

export const emitCatalogEventToStores = async (event: string, payload: Record<string, unknown> = {}, storeIds?: string[]) => {
    if (!io) return
    const ids = storeIds ?? (await Store.find({ active: true }).select({ _id: 1 }).lean()).map((store) => String(store._id))
    for (const storeId of ids) emitStoreEvent(storeId, event, payload)
}
