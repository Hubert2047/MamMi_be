export const TABLE_SESSION_DURATION_MS = 12 * 60 * 60 * 1000

export const tableSessionExpiry = (from: Date) =>
    new Date(from.getTime() + TABLE_SESSION_DURATION_MS)
