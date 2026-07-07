import type { StaticSyntaxFileRecord } from './types'

type RecordResult = StaticSyntaxFileRecord | undefined
type RecordLoader = () => Promise<RecordResult> | RecordResult
type ManyRecordLoader = (files: readonly string[]) => Promise<ReadonlyMap<string, StaticSyntaxFileRecord>>

export interface ProvidedStaticSyntaxRecordCache {
  read(file: string, load: RecordLoader): Promise<RecordResult>
  readMany(files: readonly string[], load: ManyRecordLoader): Promise<ReadonlyMap<string, StaticSyntaxFileRecord>>
}

/**
 * Creates a bounded cache for provided syntax records.
 *
 * Projection reads imported records repeatedly while processing file batches.
 * This cache keeps the lazy provider contract but avoids repeating disk reads
 * and JSON materialization for hot records.
 */
export function createProvidedStaticSyntaxRecordCache(maxEntries: number): ProvidedStaticSyntaxRecordCache {
  if (maxEntries <= 0) return uncachedProvidedStaticSyntaxRecords()
  const entries = new Map<string, Promise<RecordResult>>()

  const set = (file: string, value: Promise<RecordResult>): void => {
    entries.delete(file)
    entries.set(file, value)
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (!oldest) break
      entries.delete(oldest)
    }
  }

  const read = async (file: string, load: RecordLoader): Promise<RecordResult> => {
    const cached = entries.get(file)
    if (cached) {
      entries.delete(file)
      entries.set(file, cached)
      return readEntry(entries, file, cached)
    }
    const loaded = Promise.resolve(load())
    set(file, loaded)
    return readEntry(entries, file, loaded)
  }

  return {
    read,
    readMany: async (files, load) => {
      const records = new Map<string, StaticSyntaxFileRecord>()
      const missing: string[] = []

      await Promise.all(
        files.map(async (file) => {
          const cached = entries.get(file)
          if (!cached) {
            missing.push(file)
            return
          }
          entries.delete(file)
          entries.set(file, cached)
          const record = await readEntry(entries, file, cached)
          if (record) records.set(file, record)
        }),
      )

      if (missing.length > 0) {
        const loaded = await load(missing)
        for (const file of missing) {
          const record = loaded.get(file)
          if (record) records.set(file, record)
          set(file, Promise.resolve(record))
        }
      }

      return records
    },
  }
}

async function readEntry(
  entries: Map<string, Promise<RecordResult>>,
  file: string,
  value: Promise<RecordResult>,
): Promise<RecordResult> {
  try {
    return await value
  } catch (error) {
    if (entries.get(file) === value) entries.delete(file)
    throw error
  }
}

function uncachedProvidedStaticSyntaxRecords(): ProvidedStaticSyntaxRecordCache {
  return {
    read: (_file, load) => Promise.resolve(load()),
    readMany: (_files, load) => load(_files),
  }
}
