export interface Policy {
  /** Requests a tenant can make in one burst. */
  capacity: number
  /** Requests per second the bucket refills at. */
  refillPerSec: number
}

export const plans: Record<string, Policy> = {
  free: { capacity: 30, refillPerSec: 0.5 },
  standard: { capacity: 120, refillPerSec: 2 },
  partner: { capacity: 600, refillPerSec: 10 },
}

/**
 * Routes limited to a share of the plan. Search and quotes fan out to every ferry operator, and a
 * booking holds a seat with the operator until it is paid.
 */
export const routeShares: Record<string, number> = {
  'GET /v1/search': 0.25,
  'POST /v1/quotes': 0.25,
  'POST /v1/bookings': 0.5,
}

/** Routes partners poll to check on the gateway and on their own limits. */
export const exemptRoutes: ReadonlySet<string> = new Set(['GET /v1/status', 'GET /v1/limits'])

/**
 * Returns the policy for a plan on a route, or undefined when the route is exempt from rate
 * limiting. A plan the gateway does not know gets the free plan's limits.
 */
export function policyFor(plan: string, route: string): Policy | undefined {
  if (exemptRoutes.has(route)) return undefined
  const base = Object.hasOwn(plans, plan) ? plans[plan] : plans.free
  const share = Object.hasOwn(routeShares, route) ? routeShares[route] : 1
  return {
    capacity: Math.max(1, Math.floor(base.capacity * share)),
    refillPerSec: base.refillPerSec * share,
  }
}
