import { readFile } from 'node:fs/promises'
import { sha256 } from '../../cache-identity'

export interface SourceHashMemo {
  read(file: string): Promise<string | undefined>
}

/**
 * Memoizes source content hashes for cache-status planning.
 *
 * Static cache manifests can reference the same dependency from many files.
 * Caching the hash promise avoids repeated reads while preserving the
 * best-effort cache contract: unreadable files resolve to `undefined` and
 * become cache misses.
 */
export function createSourceHashMemo(): SourceHashMemo {
  const hashes = new Map<string, Promise<string | undefined>>()
  return {
    read(file) {
      const cached = hashes.get(file)
      if (cached) return cached
      const hash = readFile(file, 'utf8')
        .then((source) => sha256(source))
        .catch(() => undefined)
      hashes.set(file, hash)
      return hash
    },
  }
}
