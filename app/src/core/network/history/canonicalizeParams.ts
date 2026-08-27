/**
 * Canonical JSON for a params object: object keys sorted recursively, so two
 * runs launched with the same logical query produce byte-identical `params`
 * and the history layer groups them as "the same query". Arrays keep order.
 */
export function canonicalizeParams(params: Record<string, unknown>): Record<string, unknown> {
  return sortValue(params) as Record<string, unknown>
}

/** Stable string form, for use as a grouping key. */
export function paramsKey(params: Record<string, unknown>): string {
  return JSON.stringify(sortValue(params))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key])
    }
    return out
  }
  return value
}
