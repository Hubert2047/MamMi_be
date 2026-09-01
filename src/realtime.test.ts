import { describe, expect, it } from 'vitest'
import { channelForRealtimeEvent, channelsForClient, roomForOrder, roomForStoreChannel } from './realtime.js'
import { Role } from './constants/role.js'

describe('realtime channel policy', () => {
    it('routes events to the correct business channel', () => {
        expect(channelForRealtimeEvent('catalog.store-item.price.updated')).toBe('catalog')
        expect(channelForRealtimeEvent('order.created')).toBe('orders')
        expect(channelForRealtimeEvent('closing.voided')).toBe('closing')
        expect(channelForRealtimeEvent('revenue.created')).toBe('finance')
        expect(channelForRealtimeEvent('revenue.updated')).toBe('finance')
        expect(channelForRealtimeEvent('revenue.deleted')).toBe('finance')
        expect(channelForRealtimeEvent('expense.created')).toBe('finance')
        expect(channelForRealtimeEvent('expense.updated')).toBe('finance')
        expect(channelForRealtimeEvent('expense.deleted')).toBe('finance')
        expect(channelForRealtimeEvent('unknown.event')).toBeNull()
    })

    it('limits each client type to the data it needs', () => {
        expect(channelsForClient('pos', Role.Employee)).toEqual(['catalog', 'orders', 'finance'])
        expect(channelsForClient('admin', Role.Admin)).toEqual(['catalog', 'orders', 'closing', 'finance'])
        expect(channelsForClient('customer', Role.Guest)).toEqual(['catalog'])
    })

    it('always grants superadmin closing visibility even when the client identifies as POS', () => {
        expect(channelsForClient('pos', Role.SuperAdmin)).toEqual(['catalog', 'orders', 'closing', 'finance'])
    })

    it('keeps store and order rooms deterministic and isolated', () => {
        expect(roomForStoreChannel('store-a', 'orders')).toBe('store:store-a:orders')
        expect(roomForStoreChannel('store-b', 'orders')).not.toBe(roomForStoreChannel('store-a', 'orders'))
        expect(roomForOrder('order-a')).not.toBe(roomForOrder('order-b'))
    })
})
