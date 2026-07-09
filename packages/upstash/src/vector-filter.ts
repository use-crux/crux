import { StorageError } from '@use-crux/core/storage'
import type { ExactFilter } from '@use-crux/core/storage'

/** Compile a beta exact filter into Upstash Vector's filter expression syntax. */
export function upstashFilter(filter: ExactFilter | undefined): string | undefined {
  if (!filter) return undefined
  const clauses = Object.entries(filter).map(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new StorageError('invalid_filter', `Upstash Vector filter key "${key}" is not supported.`)
    }
    const encoded = encodeFilterValue(value)
    if (!encoded) {
      throw new StorageError('invalid_filter', 'Upstash Vector filters support only scalar JSON values.')
    }
    return `${key} = ${encoded}`
  })
  return clauses.length > 0 ? clauses.join(' and ') : undefined
}

function encodeFilterValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  if (value === null) {
    return 'null'
  }
  return undefined
}
