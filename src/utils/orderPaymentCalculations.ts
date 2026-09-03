export type PayableOrderStatus = 'pending' | 'paid' | 'cancelled'

export const getPaidAt = (status: PayableOrderStatus, now = new Date()): Date | undefined =>
    status === 'paid' ? now : undefined

export const isCashReceivedSufficient = (cashReceived: unknown, totalPrice: number): boolean =>
    typeof cashReceived === 'number' && Number.isFinite(cashReceived) && cashReceived >= totalPrice
