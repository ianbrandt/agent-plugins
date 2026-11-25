import type { ServerResponse } from 'node:http'
import type { RateLimiter } from './limiter.ts'
import type { ApiRequest } from './router.ts'

export type Next = () => void

/** Answers 429 when the tenant is over its limit, and reports the limit in headers either way. */
export function rateLimit(limiter: RateLimiter) {
  return (req: ApiRequest, res: ServerResponse, next: Next): void => {
    const decision = limiter.check(req.tenant)
    res.setHeader('RateLimit-Remaining', String(decision.remaining))
    if (decision.allowed) return next()

    res.statusCode = 429
    res.setHeader('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)))
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'rate_limited', retryAfterMs: decision.retryAfterMs }))
  }
}
