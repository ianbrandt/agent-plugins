import type { IncomingMessage } from 'node:http'
import type { Tenant } from './tenants.ts'

/** A request after authentication and routing. */
export interface ApiRequest extends IncomingMessage {
  tenant: Tenant
  /** The matched route as method and pattern, such as `GET /v1/bookings/:id`. */
  route: string
  params: Record<string, string>
}

export interface Route {
  method: string
  pattern: string
}

export const routes: Route[] = [
  { method: 'GET', pattern: '/v1/status' },
  { method: 'GET', pattern: '/v1/limits' },
  { method: 'GET', pattern: '/v1/search' },
  { method: 'POST', pattern: '/v1/quotes' },
  { method: 'POST', pattern: '/v1/bookings' },
  { method: 'GET', pattern: '/v1/bookings/:id' },
  { method: 'DELETE', pattern: '/v1/bookings/:id' },
]

/** Finds the route for a method and path, with the path's parameters. */
export function matchRoute(
  method: string,
  path: string,
): { route: string; params: Record<string, string> } | undefined {
  const segments = path.split('/')
  for (const { method: m, pattern } of routes) {
    if (m !== method) continue
    const expected = pattern.split('/')
    if (expected.length !== segments.length) continue
    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < expected.length && matched; i++) {
      if (expected[i].startsWith(':')) params[expected[i].slice(1)] = decodeURIComponent(segments[i])
      else matched = expected[i] === segments[i]
    }
    if (matched) return { route: `${m} ${pattern}`, params }
  }
  return undefined
}
