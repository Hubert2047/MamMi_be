export type AttendanceSession = {
    checkIn: Date
    checkOut?: Date
}

export const sessionMinutes = (session: AttendanceSession, now = new Date()): number => {
    const start = new Date(session.checkIn).getTime()
    const end = new Date(session.checkOut || now).getTime()
    return Math.max(0, Math.floor((end - start) / 60000))
}

export const completedHours = (sessions: AttendanceSession[]): number =>
    sessions.reduce((total, session) => total + (session.checkOut ? new Date(session.checkOut).getTime() - new Date(session.checkIn).getTime() : 0), 0) / (1000 * 60 * 60)

export const isValidSessionRange = (checkIn: Date, checkOut?: Date): boolean =>
    !checkOut || new Date(checkOut).getTime() >= new Date(checkIn).getTime()
