import { createHash } from 'node:crypto'
import type { StaticExtractionInstrumentation } from '../../../static/instrumentation'
import type {
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontend,
  StaticSyntaxFrontendIdentity,
  StaticSyntaxFrontendName,
} from './types'
import { createProvidedStaticSyntaxRecordCache } from './provided-record-cache'
import { providedRecordFromProvider, providedRecordsFromProvider } from './provided-serialized-records'

const DEFAULT_PROVIDER_RECORD_CACHE_SIZE = 512

export type SerializedStaticSyntaxRecord = string | Uint8Array

/** Error thrown when a provided syntax record fails identity or source validation. */
export class StaticSyntaxRecordIntegrityError extends Error {
  readonly file: string

  constructor(file: string, message: string) {
    super(message)
    this.name = 'StaticSyntaxRecordIntegrityError'
    this.file = file
  }
}

/** Returns whether an error came from provided-record integrity validation. */
export function isStaticSyntaxRecordIntegrityError(error: unknown): error is StaticSyntaxRecordIntegrityError {
  return error instanceof StaticSyntaxRecordIntegrityError
}

/** Lazy lookup surface for externally produced syntax records. */
export interface ProvidedStaticSyntaxRecordProvider {
  /**
   * Syntax frontend identity for records returned by this provider.
   *
   * Callers may also pass `identity` to `createProvidedStaticSyntaxFrontend`.
   * When both are present they must match.
   */
  readonly identity?: StaticSyntaxFrontendIdentity
  /**
   * Returns the syntax record for an absolute file path, or `undefined` when
   * the provider does not own that file.
   */
  read(file: string): Promise<StaticSyntaxFileRecord | undefined> | StaticSyntaxFileRecord | undefined
  /**
   * Returns the serialized JSON record for an absolute file path.
   *
   * Worker transports can implement this to let the compiler adapter measure
   * provider I/O separately from JSON materialization. When present, the
   * provided frontend prefers it over `read(...)`.
   */
  readSerialized?(
    file: string,
  ): Promise<SerializedStaticSyntaxRecord | undefined> | SerializedStaticSyntaxRecord | undefined
  /**
   * Returns syntax records for a batch of absolute file paths.
   *
   * Implementations may omit files they do not own. The adapter preserves
   * caller input order and falls back per missing file when a fallback frontend
   * is available.
   */
  readMany?(
    files: readonly string[],
  ): Promise<ReadonlyMap<string, StaticSyntaxFileRecord>> | ReadonlyMap<string, StaticSyntaxFileRecord>
  /**
   * Returns serialized JSON records for a batch of absolute file paths.
   *
   * Missing files may be omitted from the returned map. The adapter preserves
   * caller input order and falls back per missing file when a fallback frontend
   * is available.
   */
  readManySerialized?(
    files: readonly string[],
  ): Promise<ReadonlyMap<string, SerializedStaticSyntaxRecord>> | ReadonlyMap<string, SerializedStaticSyntaxRecord>
}

/**
 * Options for adapting externally produced syntax records into the static
 * extraction frontend contract.
 */
export interface ProvidedStaticSyntaxFrontendOptions {
  /**
   * Complete syntax records keyed by absolute source file path.
   *
   * Records are expected to have been produced from the same source text the
   * compiler will read during extraction. `parseFile(...)` validates the
   * SHA-256 source hash before returning a record.
   */
  readonly records?: readonly StaticSyntaxFileRecord[]
  /**
   * Lazy record provider used when records should not be retained as one
   * in-memory array.
   */
  readonly recordProvider?: ProvidedStaticSyntaxRecordProvider
  /**
   * Frontend identity to use when no records are available yet.
   *
   * Non-empty record sets infer identity from `record.frontend` and reject
   * mixed identities, because cache identity must describe one static frontend
   * implementation for the extraction run.
   */
  readonly identity?: StaticSyntaxFrontendIdentity
  /** Optional timing hooks for provider I/O and JSON materialization. */
  readonly instrumentation?: StaticExtractionInstrumentation
  /**
   * Maximum provided records to memoize while projecting.
   *
   * Set to `0` to disable. The default is sized to keep hot imported records
   * local without requiring projection to retain an explicit project-wide array.
   */
  readonly recordCacheSize?: number
  /**
   * Frontend used when a requested dependency was not part of the provided
   * record set.
   *
   * Batch callers usually provide records only for the selected source files.
   * Cross-file extraction may still need imported helper or tree-leaf records,
   * so the adapter behaves as a validated memo overlay instead of a closed
   * world snapshot.
   */
  readonly fallback?: StaticSyntaxFrontend
}

/**
 * Creates a syntax frontend from records supplied by an external parser.
 *
 * This is the Go/Rust handoff adapter: Go can parse files through the Rust/Oxc
 * indexer worker, then ask Node to project those records through the existing
 * compiler and trusted TypeScript extension runtime without exposing parser AST
 * objects or pointers.
 */
export function createProvidedStaticSyntaxFrontend(options: ProvidedStaticSyntaxFrontendOptions): StaticSyntaxFrontend {
  if (options.records !== undefined && options.recordProvider) {
    throw new Error('Provided static syntax frontend accepts either records or recordProvider, not both')
  }
  const records = options.records ?? []
  const inferredIdentity = inferRecordIdentity(records)
  const recordProvider = options.recordProvider ?? recordProviderFromRecords(records)
  const recordCache = createProvidedStaticSyntaxRecordCache(options.recordCacheSize ?? DEFAULT_PROVIDER_RECORD_CACHE_SIZE)
  const identity =
    options.identity ?? options.recordProvider?.identity ?? inferredIdentity ?? options.fallback?.identity
  if (!identity) {
    throw new Error('Provided static syntax frontend requires records, a fallback, or an explicit identity')
  }
  assertStaticSyntaxFrontendName(identity.name)
  if (
    options.identity &&
    inferredIdentity &&
    (options.identity.name !== inferredIdentity.name || options.identity.version !== inferredIdentity.version)
  ) {
    throw new Error(
      `Provided static syntax frontend identity ${options.identity.name}@${options.identity.version} does not match record identity ${inferredIdentity.name}@${inferredIdentity.version}`,
    )
  }
  if (
    options.recordProvider?.identity &&
    (options.recordProvider.identity.name !== identity.name ||
      options.recordProvider.identity.version !== identity.version)
  ) {
    throw new Error(
      `Provided static syntax frontend provider identity ${options.recordProvider.identity.name}@${options.recordProvider.identity.version} does not match adapter identity ${identity.name}@${identity.version}`,
    )
  }
  if (
    options.fallback &&
    (options.fallback.identity.name !== identity.name || options.fallback.identity.version !== identity.version)
  ) {
    throw new Error(
      `Provided static syntax frontend fallback identity ${options.fallback.identity.name}@${options.fallback.identity.version} does not match adapter identity ${identity.name}@${identity.version}`,
    )
  }

  const parseProvidedFile = async (input: StaticSyntaxFileInput): Promise<StaticSyntaxFileRecord> => {
    return providedRecordForInput({
      input,
      identity,
      fallback: options.fallback,
      read: () =>
        recordCache.read(input.file, () =>
          providedRecordFromProvider({
            provider: recordProvider,
            file: input.file,
            instrumentation: options.instrumentation,
          }),
        ),
    })
  }

  return Object.freeze({
    name: identity.name,
    identity,
    parseFile: parseProvidedFile,
    parseFiles: async (inputs: readonly StaticSyntaxFileInput[]) => {
      if (!recordProvider.readMany && !recordProvider.readManySerialized) return Promise.all(inputs.map(parseProvidedFile))
      const recordsByFile = await recordCache.readMany(inputs.map((input) => input.file), (files) =>
        providedRecordsFromProvider({
          provider: recordProvider,
          files,
          instrumentation: options.instrumentation,
        }),
      )
      return Promise.all(
        inputs.map((input) =>
          providedRecordForInput({
            input,
            identity,
            fallback: options.fallback,
            read: () => recordsByFile.get(input.file),
          }),
        ),
      )
    },
  })
}

function recordProviderFromRecords(records: readonly StaticSyntaxFileRecord[]): ProvidedStaticSyntaxRecordProvider {
  const recordsByFile = recordsByAbsoluteFile(records)
  return {
    identity: inferRecordIdentity(records),
    read: (file) => recordsByFile.get(file),
    readMany: (files) => recordsForFiles(recordsByFile, files),
  }
}

function recordsByAbsoluteFile(
  records: readonly StaticSyntaxFileRecord[],
): ReadonlyMap<string, StaticSyntaxFileRecord> {
  const recordsByFile = new Map<string, StaticSyntaxFileRecord>()
  for (const record of records) {
    if (recordsByFile.has(record.file)) {
      throw new Error(`Duplicate provided static syntax record for ${record.file}`)
    }
    recordsByFile.set(record.file, record)
  }
  return recordsByFile
}

function inferRecordIdentity(records: readonly StaticSyntaxFileRecord[]): StaticSyntaxFrontendIdentity | undefined {
  let identity: StaticSyntaxFrontendIdentity | undefined
  for (const record of records) {
    assertStaticSyntaxFrontendName(record.frontend.name)
    if (!identity) {
      identity = record.frontend
      continue
    }
    if (identity.name !== record.frontend.name || identity.version !== record.frontend.version) {
      throw new Error(
        `Provided static syntax records use mixed frontend identities: ${identity.name}@${identity.version} and ${record.frontend.name}@${record.frontend.version}`,
      )
    }
  }
  return identity
}

function assertStaticSyntaxFrontendName(value: string): asserts value is StaticSyntaxFrontendName {
  if (value !== 'typescript' && value !== 'oxc-rust') {
    throw new Error(`Unsupported provided static syntax frontend: ${value}`)
  }
}

function assertRecordIdentity(record: StaticSyntaxFileRecord, identity: StaticSyntaxFrontendIdentity): void {
  if (record.frontend.name !== identity.name || record.frontend.version !== identity.version) {
    throw new StaticSyntaxRecordIntegrityError(
      record.file,
      `Provided static syntax record for ${record.file} uses ${record.frontend.name}@${record.frontend.version}, expected ${identity.name}@${identity.version}`,
    )
  }
}

async function providedRecordForInput(input: {
  readonly input: StaticSyntaxFileInput
  readonly identity: StaticSyntaxFrontendIdentity
  readonly fallback: StaticSyntaxFrontend | undefined
  readonly read: () => Promise<StaticSyntaxFileRecord | undefined> | StaticSyntaxFileRecord | undefined
}): Promise<StaticSyntaxFileRecord> {
  const record = await input.read()
  if (!record) {
    if (input.fallback) return input.fallback.parseFile(input.input)
    throw new StaticSyntaxRecordIntegrityError(
      input.input.file,
      `No provided static syntax record for ${input.input.file}`,
    )
  }
  assertRecordIdentity(record, input.identity)
  const sourceHash = sha256(input.input.source)
  if (record.sourceHash !== sourceHash) {
    throw new StaticSyntaxRecordIntegrityError(
      input.input.file,
      `Provided static syntax record for ${input.input.file} does not match current source text`,
    )
  }
  return record
}

function recordsForFiles(
  recordsByFile: ReadonlyMap<string, StaticSyntaxFileRecord>,
  files: readonly string[],
): ReadonlyMap<string, StaticSyntaxFileRecord> {
  const records = new Map<string, StaticSyntaxFileRecord>()
  for (const file of files) {
    const record = recordsByFile.get(file)
    if (record) records.set(file, record)
  }
  return records
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
