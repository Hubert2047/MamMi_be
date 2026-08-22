export type PayableOrderStatus = 'pending' | 'paid' | 'cancelled'

export const getPaidAt = (status: PayableOrderStatus, now = new Date()): Date | undefined =>
    status === 'paid' ? now : undefined
