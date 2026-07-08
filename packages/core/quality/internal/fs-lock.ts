/**
 * Portable directory locks for multi-writer Quality artifacts.
 *
 * `mkdir` is atomic on local filesystems, which is enough for the cassette,
 * baseline, and output-cache write paths without adding a platform-specific
 * file-locking dependency.
 *
 * @internal
 * @module
 */

import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ulid } from './ulid'

const RETRY_MS = 50
const TIMEOUT_MS = 10_000
const STALE_MS = 30_000

class QualityLockTimeoutError extends Error {
  readonly code = 'quality-lock-timeout'

  constructor(path: string) {
    super(`timed out acquiring quality file lock for ${path}`)
    this.name = 'QualityLockTimeoutError'
  }
}

/**
 * Run `fn` while holding a mkdir-based lock for `path`.
 *
 * The lock directory is `${path}.lock` and contains `owner.json` for debugging
 * stalled runs. Stale locks older than 30 seconds are removed once.
 *
 * @internal
 */
export async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`
  await acquireLock(lockPath, path)
  try {
    return await fn()
  } finally {
    await rm(lockPath, { recursive: true, force: true })
  }
}

async function acquireLock(lockPath: string, targetPath: string): Promise<void> {
  const startedAt = Date.now()
  let staleTakeoverAttempted = false
  for (;;) {
    try {
      await mkdir(lockPath)
      await writeOwner(lockPath)
      return
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      if (!staleTakeoverAttempted && (await isStale(lockPath))) {
        staleTakeoverAttempted = true
        await rm(lockPath, { recursive: true, force: true })
        continue
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) throw new QualityLockTimeoutError(targetPath)
      await sleep(RETRY_MS)
    }
  }
}

async function writeOwner(lockPath: string): Promise<void> {
  const owner = {
    pid: typeof process !== 'undefined' ? process.pid : undefined,
    id: ulid(),
    at: new Date().toISOString(),
  }
  await writeFile(join(lockPath, 'owner.json'), `${JSON.stringify(owner, null, 2)}\n`, 'utf8')
}

async function isStale(lockPath: string): Promise<boolean> {
  try {
    const info = await stat(lockPath)
    return Date.now() - info.mtimeMs > STALE_MS
  } catch {
    return false
  }
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
