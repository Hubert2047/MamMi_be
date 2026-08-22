import { describe, expect, it } from 'vitest'
import { channelForRealtimeEvent, channelsForClient, roomForOrder, roomForStoreChannel } from './realtime.js'
import { Role } from './constants/role.js'

describe('realtime channel policy', () => {
    it('routes events to the correct business channel', () => {
        expect(channelForRealtimeEvent('catalog.store-item.price.updated')).toBe('catalog')
        expect(channelForRealtimeEvent('order.created')).toBe('orders')
        expect(channelForRealtimeEvent('closing.voided')).toBe('closing')
        expect(channelForRealtimeEvent('unknown.event')).toBeNull()
    })

    it('limits each client type to the data it needs', () => {
        expect(channelsForClient('pos', Role.Employee)).toEqual(['catalog', 'orders'])
        expect(channelsForClient('admin', Role.Admin)).toEqual(['catalog', 'orders', 'closing'])
        expect(channelsForClient('customer', Role.Guest)).toEqual(['catalog'])
    })

    it('always grants superadmin closing visibility even when the client identifies as POS', () => {
        expect(channelsForClient('pos', Role.SuperAdmin)).toEqual(['catalog', 'orders', 'closing'])
    })

    it('keeps store and order rooms deterministic and isolated', () => {
        expect(roomForStoreChannel('store-a', 'orders')).toBe('store:store-a:orders')
        expect(roomForStoreChannel('store-b', 'orders')).not.toBe(roomForStoreChannel('store-a', 'orders'))
        expect(roomForOrder('order-a')).not.toBe(roomForOrder('order-b'))
    })
})
