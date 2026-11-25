/** Keys a rate-limit bucket by tenant and route, such as `acme:GET /v1/bookings/:id`. */
export function bucketKey(tenantId: string, route: string): string {
  return `${tenantId}:${route}`
}

/** Splits a bucket key back into its tenant and route. */
export function parseBucketKey(key: string): { tenantId: string; route: string } {
  const at = key.indexOf(':')
  return { tenantId: key.slice(0, at), route: key.slice(at + 1) }
}
