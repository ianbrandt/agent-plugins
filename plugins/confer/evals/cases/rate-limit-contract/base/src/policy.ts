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

/** Returns the policy for a plan, or undefined when the gateway does not know the plan. */
export function policyFor(plan: string): Policy | undefined {
  return Object.hasOwn(plans, plan) ? plans[plan] : undefined
}
