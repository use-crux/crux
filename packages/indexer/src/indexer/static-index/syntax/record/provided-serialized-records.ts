import { TextDecoder } from 'node:util'
import { withStaticExtractionTiming, type StaticExtractionInstrumentation } from '../../../static/instrumentation'
import type {
  ProvidedStaticSyntaxRecordProvider,
  SerializedStaticSyntaxRecord,
} from './provided-frontend'
import type { StaticSyntaxFileRecord } from './types'

const utf8Decoder = new TextDecoder()

export async function providedRecordFromProvider(input: {
  readonly provider: ProvidedStaticSyntaxRecordProvider
  readonly file: string
  readonly instrumentation: StaticExtractionInstrumentation | undefined
}): Promise<StaticSyntaxFileRecord | undefined> {
  const readSerialized = input.provider.readSerialized
  if (readSerialized) {
    const serialized = await withStaticExtractionTiming(
      input.instrumentation,
      'static.syntax_record.provider_read',
      input.file,
      () => readSerialized(input.file),
    )
    if (!serialized) return undefined
    return withStaticExtractionTiming(input.instrumentation, 'static.syntax_record.provider_json_parse', input.file, () =>
      parseSerializedRecord(serialized),
    )
  }
  return withStaticExtractionTiming(input.instrumentation, 'static.syntax_record.provider_read', input.file, () =>
    input.provider.read(input.file),
  )
}

export async function providedRecordsFromProvider(input: {
  readonly provider: ProvidedStaticSyntaxRecordProvider
  readonly files: readonly string[]
  readonly instrumentation: StaticExtractionInstrumentation | undefined
}): Promise<ReadonlyMap<string, StaticSyntaxFileRecord>> {
  const readManySerialized = input.provider.readManySerialized
  if (readManySerialized) {
    const serializedByFile = await withStaticExtractionTiming(
      input.instrumentation,
      'static.syntax_record.provider_read',
      undefined,
      () => readManySerialized(input.files),
    )
    return withStaticExtractionTiming(
      input.instrumentation,
      'static.syntax_record.provider_json_parse',
      undefined,
      () => recordsFromSerializedMap(serializedByFile),
    )
  }
  const readMany = input.provider.readMany
  if (readMany) {
    return withStaticExtractionTiming(input.instrumentation, 'static.syntax_record.provider_read', undefined, () =>
      readMany(input.files),
    )
  }
  const records = new Map<string, StaticSyntaxFileRecord>()
  await Promise.all(
    input.files.map(async (file) => {
      const record = await providedRecordFromProvider({
        provider: input.provider,
        file,
        instrumentation: input.instrumentation,
      })
      if (record) records.set(file, record)
    }),
  )
  return records
}

function recordsFromSerializedMap(
  serializedByFile: ReadonlyMap<string, SerializedStaticSyntaxRecord>,
): ReadonlyMap<string, StaticSyntaxFileRecord> {
  const records = new Map<string, StaticSyntaxFileRecord>()
  for (const [file, serialized] of serializedByFile) {
    records.set(file, parseSerializedRecord(serialized))
  }
  return records
}

function parseSerializedRecord(serialized: SerializedStaticSyntaxRecord): StaticSyntaxFileRecord {
  const json = typeof serialized === 'string' ? serialized : utf8Decoder.decode(serialized)
  return JSON.parse(json) as StaticSyntaxFileRecord
}
