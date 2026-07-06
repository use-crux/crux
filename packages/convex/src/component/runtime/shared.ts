export function randomId(prefix: string): string {
  const cryptoApi = globalThis.crypto
  const suffix =
    cryptoApi && typeof cryptoApi.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `${prefix}_${suffix}`
}

export function matchesTopLevel(
  payload: unknown,
  match: Record<string, unknown>,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return Object.keys(match).length === 0
  }
  const record = payload as Record<string, unknown>
  return Object.entries(match).every(([key, value]) => Object.is(record[key], value))
}

export function limitRows<T>(rows: readonly T[], limit?: number): readonly T[] {
  return rows.slice(0, Math.max(0, Math.floor(limit ?? rows.length)))
}

export function pruneBatch<T>(
  rows: readonly T[],
  limit: number,
): { readonly selected: readonly T[]; readonly truncated: boolean } {
  const normalized = Math.max(0, Math.floor(limit))
  return {
    selected: rows.slice(0, normalized),
    truncated: rows.length > normalized,
  }
}
