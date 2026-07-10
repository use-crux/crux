/**
 * Atomic filesystem writes for Quality artifacts.
 *
 * Every JSON artifact under `.crux/quality` is written by creating a temporary
 * file in the same directory, fsyncing it, renaming it over the target, and
 * best-effort fsyncing the directory entry.
 *
 * @internal
 * @module
 */

import { open, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { ulid } from './ulid'

/**
 * Atomically replace `path` with `data`.
 *
 * The temporary file lives in the target directory so the final rename does
 * not cross filesystems.
 *
 * @internal
 */
export async function writeFileAtomic(path: string, data: string): Promise<void> {
  const tmpPath = `${path}.${ulid()}.tmp`
  let committed = false
  const file = await open(tmpPath, 'w')
  try {
    await file.writeFile(data, 'utf8')
    await file.sync()
    await file.close()
    await rename(tmpPath, path)
    committed = true
    await fsyncDirectory(dirname(path))
  } finally {
    await closeQuietly(file)
    if (!committed) await unlink(tmpPath).catch(() => undefined)
  }
}

async function closeQuietly(file: Awaited<ReturnType<typeof open>>): Promise<void> {
  try {
    await file.close()
  } catch {
    // The file may already be closed after a successful sync+rename path.
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  let dir: Awaited<ReturnType<typeof open>> | undefined
  try {
    dir = await open(path, 'r')
    await dir.sync()
  } catch {
    // Some platforms/filesystems do not allow directory fsync. The file rename
    // is still atomic; directory fsync is a durability best effort.
  } finally {
    if (dir !== undefined) await closeQuietly(dir)
  }
}
