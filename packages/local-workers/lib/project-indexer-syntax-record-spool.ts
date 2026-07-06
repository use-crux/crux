import { appendFile, mkdtemp, open, rm, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ProvidedStaticSyntaxRecordProvider,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontendIdentity,
} from '@use-crux/indexer/host/static-index'

interface SyntaxRecordSpoolEntry {
  readonly offset: number
  readonly length: number
}

export interface ProjectIndexSyntaxRecordSpool {
  /** Lazy provider consumed by `@use-crux/indexer` during AST projection. */
  readonly provider: ProvidedStaticSyntaxRecordProvider
  /** Number of records currently spooled. */
  readonly recordCount: number
  /** Writes one transport batch to the spool. */
  writeBatch(records: readonly StaticSyntaxFileRecord[]): Promise<void>
  /** Marks the producer complete and releases reads for records that never arrived. */
  close(): void
  /** Removes temporary spool files. Safe to call more than once. */
  dispose(): Promise<void>
}

/**
 * Creates a temp-file-backed syntax record spool.
 *
 * Chunked worker requests should not be reassembled into one project-wide
 * JavaScript array. The spool stores records in one append-only JSONL file and
 * exposes a lazy provider that reads records by absolute file path during
 * projection.
 */
export function createProjectIndexSyntaxRecordSpool(
  options: { readonly identity?: StaticSyntaxFrontendIdentity } = {},
): ProjectIndexSyntaxRecordSpool {
  let dir: string | undefined
  let disposed = false
  let closed = false
  let identity = options.identity
  let byteLength = 0
  const recordsByFile = new Map<string, SyntaxRecordSpoolEntry>()
  const waitersByFile = new Map<string, Set<() => void>>()
  const closeWaiters = new Set<() => void>()

  const ensureDir = async (): Promise<string> => {
    if (disposed) throw new Error('Project Index syntax record spool is already disposed')
    dir ??= await mkdtemp(join(tmpdir(), 'crux-indexer-syntax-records-'))
    return dir
  }

  const ensureSpoolFile = async (): Promise<string> => join(await ensureDir(), 'records.jsonl')

  const provider: ProvidedStaticSyntaxRecordProvider = {
    get identity() {
      return identity
    },
    read: async (file) => {
      const entry = await entryForFile(file)
      if (!entry) return undefined
      const handle = await open(await ensureSpoolFile(), 'r')
      try {
        return parseRecordBuffer(await readRecordBuffer(handle, entry))
      } finally {
        await handle.close()
      }
    },
    readSerialized: async (file) => {
      const entry = await entryForFile(file)
      if (!entry) return undefined
      const handle = await open(await ensureSpoolFile(), 'r')
      try {
        return await readRecordBuffer(handle, entry)
      } finally {
        await handle.close()
      }
    },
    readMany: async (files) => {
      await waitForFiles(files)
      const records = new Map<string, StaticSyntaxFileRecord>()
      const entries = files.flatMap((file) => {
        const entry = recordsByFile.get(file)
        return entry ? [{ file, entry }] : []
      })
      if (entries.length === 0) return records
      const handle = await open(await ensureSpoolFile(), 'r')
      try {
        for (const { file, entry } of entries) {
          records.set(file, parseRecordBuffer(await readRecordBuffer(handle, entry)))
        }
      } finally {
        await handle.close()
      }
      return records
    },
    readManySerialized: async (files) => {
      await waitForFiles(files)
      const records = new Map<string, Buffer>()
      const entries = files.flatMap((file) => {
        const entry = recordsByFile.get(file)
        return entry ? [{ file, entry }] : []
      })
      if (entries.length === 0) return records
      const handle = await open(await ensureSpoolFile(), 'r')
      try {
        for (const { file, entry } of entries) {
          records.set(file, await readRecordBuffer(handle, entry))
        }
      } finally {
        await handle.close()
      }
      return records
    },
  }

  return {
    provider,
    get recordCount() {
      return recordsByFile.size
    },
    writeBatch: async (records) => {
      if (records.length === 0) return
      const batchEntries = new Map<string, SyntaxRecordSpoolEntry>()
      const payload: string[] = []
      let nextOffset = byteLength
      for (const record of records) {
        assertRecord(record)
        assertRecordIdentity(record)
        if (recordsByFile.has(record.file) || batchEntries.has(record.file)) {
          throw new Error(`Duplicate provided static syntax record for ${record.file}`)
        }
        const json = JSON.stringify(record)
        const length = Buffer.byteLength(json, 'utf8')
        batchEntries.set(record.file, { offset: nextOffset, length })
        payload.push(json, '\n')
        nextOffset += length + 1
      }
      await appendFile(await ensureSpoolFile(), payload.join(''), 'utf8')
      for (const [file, entry] of batchEntries) recordsByFile.set(file, entry)
      byteLength = nextOffset
      for (const file of batchEntries.keys()) notifyFile(file)
    },
    close: () => {
      if (closed) return
      closed = true
      notifyCloseWaiters()
    },
    dispose: async () => {
      if (disposed) return
      closed = true
      disposed = true
      notifyCloseWaiters()
      recordsByFile.clear()
      if (dir) await rm(dir, { recursive: true, force: true })
      dir = undefined
    },
  }

  async function entryForFile(file: string): Promise<SyntaxRecordSpoolEntry | undefined> {
    while (!recordsByFile.has(file) && !closed) {
      await waitForFile(file)
    }
    return recordsByFile.get(file)
  }

  async function waitForFiles(files: readonly string[]): Promise<void> {
    while (!closed && files.some((file) => !recordsByFile.has(file))) {
      await waitForAnyFile(files)
    }
  }

  function waitForFile(file: string): Promise<void> {
    return new Promise((resolve) => {
      let waiters = waitersByFile.get(file)
      if (!waiters) {
        waiters = new Set()
        waitersByFile.set(file, waiters)
      }
      waiters.add(resolve)
      closeWaiters.add(resolve)
    })
  }

  function waitForAnyFile(files: readonly string[]): Promise<void> {
    return new Promise((resolve) => {
      const notify = (): void => {
        closeWaiters.delete(notify)
        for (const file of files) waitersByFile.get(file)?.delete(notify)
        resolve()
      }
      closeWaiters.add(notify)
      for (const file of files) {
        let waiters = waitersByFile.get(file)
        if (!waiters) {
          waiters = new Set()
          waitersByFile.set(file, waiters)
        }
        waiters.add(notify)
      }
    })
  }

  function notifyFile(file: string): void {
    const waiters = waitersByFile.get(file)
    if (!waiters) return
    waitersByFile.delete(file)
    for (const notify of waiters) {
      closeWaiters.delete(notify)
      notify()
    }
  }

  function notifyCloseWaiters(): void {
    const waiters = [...closeWaiters]
    closeWaiters.clear()
    waitersByFile.clear()
    for (const notify of waiters) notify()
  }

  function assertRecord(record: StaticSyntaxFileRecord): void {
    if (typeof record.file !== 'string' || record.file.length === 0) {
      throw new Error('Provided static syntax record is missing an absolute file path')
    }
  }

  function assertRecordIdentity(record: StaticSyntaxFileRecord): void {
    if (!identity) {
      identity = record.frontend
      return
    }
    if (record.frontend.name !== identity.name || record.frontend.version !== identity.version) {
      throw new Error(
        `Provided static syntax record for ${record.file} uses ${record.frontend.name}@${record.frontend.version}, expected ${identity.name}@${identity.version}`,
      )
    }
  }
}

async function readRecordBuffer(handle: FileHandle, entry: SyntaxRecordSpoolEntry): Promise<Buffer> {
  const buffer = Buffer.alloc(entry.length)
  const { bytesRead } = await handle.read(buffer, 0, entry.length, entry.offset)
  if (bytesRead !== entry.length) {
    throw new Error(`Short read for spooled Project Index syntax record at byte offset ${entry.offset}`)
  }
  return buffer
}

function parseRecordBuffer(buffer: Buffer): StaticSyntaxFileRecord {
  return JSON.parse(buffer.toString('utf8')) as StaticSyntaxFileRecord
}
