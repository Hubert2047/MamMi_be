import type { NextFunction, Request, Response } from 'express'

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()
type RateLimitKey = (req: Request) => string

export const resetPublicRateLimitsForTest = () => buckets.clear()

/** Lightweight in-process guard; production deployments should also enforce this at CDN/proxy level. */
export const publicRateLimit = (scope: string, limit: number, windowMs: number, keyFor: RateLimitKey = (req) => req.ip || 'unknown') => (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const key = `${scope}:${keyFor(req)}`
    const current = buckets.get(key)
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current
    bucket.count += 1
    buckets.set(key, bucket)
    if (bucket.count <= limit) return next()
    res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000))
    res.status(429).json({ success: false, code: 'PUBLIC_RATE_LIMITED', message: 'Too many requests. Please try again shortly.' })
}
