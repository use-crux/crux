/** Immutable schema-2 evidence retained at the indexing and retrieval boundary. */

import { sha256Hex } from '../content/sha256'
import type { DocumentProducer, SourceCoordinate } from './ingested-document'

export interface StoredEvidence {
  readonly schemaVersion: 2
  readonly documentSha256: string
  readonly producer: DocumentProducer
  readonly coordinate: SourceCoordinate
  readonly blockIds: readonly string[]
  readonly chunkId: string
  /** SHA-256 of the normalized chunk content retained in this row. */
  readonly chunkSha256: string
  readonly normalizedContent: string
  readonly normalizedContentSha256: string
  readonly normalizationVersion: string
  readonly chunkerVersion: string
}

/** Schema-2 facts shared by every normalized chunk from one document. */
export interface StoredEvidenceDocument {
  readonly documentSha256: string
  readonly producer: DocumentProducer
  readonly normalizationVersion: string
}

/** Schema-2 facts owned by a normalized source block. */
export interface StoredEvidenceOrigin {
  readonly coordinate: SourceCoordinate
  readonly producer: DocumentProducer
  readonly blockIds: readonly string[]
}

export class StoredEvidenceContractError extends Error {
  readonly code = 'STORED_EVIDENCE_CONTRACT_INVALID' as const

  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'StoredEvidenceContractError'
  }
}

/** Raised when derived content has no single truthful schema-2 evidence origin. */
export class StoredEvidenceRequiredError extends Error {
  readonly code = 'STORED_EVIDENCE_REQUIRED' as const

  constructor(message = 'Stored evidence is required before an indexed chunk can be persisted.') {
    super(message)
    this.name = 'StoredEvidenceRequiredError'
  }
}

type RecordValue = Record<string, unknown>

const SHA256 = /^[0-9a-f]{64}$/u
const PARSERS = new Set(['anydoc', 'mammoth', 'pdf-inspector', 'pdfjs-dist', 'exceljs', 'csv-parse', 'text', 'markdown', 'html', 'json'])

/** Validate, detach, and freeze exact schema-2 stored evidence. */
export function validateStoredEvidence(value: unknown): StoredEvidence {
  const record = exact(value, '$', [
    'schemaVersion',
    'documentSha256',
    'producer',
    'coordinate',
    'blockIds',
    'chunkId',
    'chunkSha256',
    'normalizedContent',
    'normalizedContentSha256',
    'normalizationVersion',
    'chunkerVersion',
  ])
  const normalizedContent = string(record.normalizedContent, '$.normalizedContent')
  const normalizedContentSha256 = digest(record.normalizedContentSha256, '$.normalizedContentSha256')
  const chunkSha256 = digest(record.chunkSha256, '$.chunkSha256')
  const actualHash = sha256Hex(new TextEncoder().encode(normalizedContent))
  if (normalizedContentSha256 !== actualHash || chunkSha256 !== actualHash) {
    fail('$.normalizedContent', 'must match both retained SHA-256 digests')
  }

  const documentSha256 = digest(record.documentSha256, '$.documentSha256')
  const coordinate = sourceCoordinate(record.coordinate, '$.coordinate')
  if (coordinate.kind === 'document' && coordinate.documentSha256 !== documentSha256) {
    fail('$.coordinate.documentSha256', 'must name the evidence document SHA-256')
  }

  return freeze({
    schemaVersion: literal(record.schemaVersion, 2, '$.schemaVersion'),
    documentSha256,
    producer: producer(record.producer, '$.producer'),
    coordinate,
    blockIds: freeze(array(record.blockIds, '$.blockIds', nonEmpty)),
    chunkId: nonEmpty(record.chunkId, '$.chunkId'),
    chunkSha256,
    normalizedContent,
    normalizedContentSha256,
    normalizationVersion: nonEmpty(record.normalizationVersion, '$.normalizationVersion'),
    chunkerVersion: nonEmpty(record.chunkerVersion, '$.chunkerVersion'),
  })
}

/** Build immutable evidence from schema-2 document, block, and chunk facts. */
export function createStoredEvidence(input: {
  readonly document: StoredEvidenceDocument
  readonly origin: StoredEvidenceOrigin
  readonly chunkId: string
  readonly normalizedContent: string
  readonly chunkerVersion: string
}): StoredEvidence {
  const contentHash = sha256Hex(new TextEncoder().encode(input.normalizedContent))
  return validateStoredEvidence({
    schemaVersion: 2,
    documentSha256: input.document.documentSha256,
    producer: input.origin.producer,
    coordinate: input.origin.coordinate,
    blockIds: input.origin.blockIds,
    chunkId: input.chunkId,
    chunkSha256: contentHash,
    normalizedContent: input.normalizedContent,
    normalizedContentSha256: contentHash,
    normalizationVersion: input.document.normalizationVersion,
    chunkerVersion: input.chunkerVersion,
  })
}

/** Serialize only validated schema-2 evidence for persistence. */
export function serializeStoredEvidence(value: StoredEvidence): string {
  return JSON.stringify(validateStoredEvidence(value))
}

/** Decode persisted evidence. Schema-1 material is rejected and must be re-ingested. */
export function deserializeStoredEvidence(value: string): StoredEvidence {
  try {
    return validateStoredEvidence(JSON.parse(value) as unknown)
  } catch (error) {
    if (error instanceof StoredEvidenceContractError) {
      throw error
    }
    throw new StoredEvidenceContractError('$', 'must be valid JSON schema-2 stored evidence')
  }
}

function producer(value: unknown, path: string): DocumentProducer {
  const record = plain(value, path)
  if (record.kind === 'parser') {
    exact(record, path, ['kind', 'name', 'version', 'adapterVersion'])
    const name = nonEmpty(record.name, `${path}.name`)
    if (!PARSERS.has(name)) {
      fail(`${path}.name`, 'must be a supported parser')
    }
    return freeze({
      kind: 'parser',
      name: name as Extract<DocumentProducer, { kind: 'parser' }>['name'],
      version: nonEmpty(record.version, `${path}.version`),
      adapterVersion: nonEmpty(record.adapterVersion, `${path}.adapterVersion`),
    })
  }
  if (record.kind === 'application-operation') {
    exact(record, path, ['kind', 'operation', 'identity', 'version'])
    if (record.operation !== 'media.describe' && record.operation !== 'media.transcribe') {
      fail(`${path}.operation`, 'must be media.describe or media.transcribe')
    }
    return freeze({
      kind: 'application-operation',
      operation: record.operation,
      identity: nonEmpty(record.identity, `${path}.identity`),
      version: nonEmpty(record.version, `${path}.version`),
    })
  }
  fail(`${path}.kind`, 'must be parser or application-operation')
}

function sourceCoordinate(value: unknown, path: string): SourceCoordinate {
  const record = plain(value, path)
  if (record.kind === 'document') {
    exact(record, path, ['kind', 'documentSha256'])
    return freeze({ kind: 'document', documentSha256: digest(record.documentSha256, `${path}.documentSha256`) })
  }
  if (record.kind === 'package-part') {
    optionalExact(record, path, ['kind', 'part'], ['anchor'])
    return freeze({
      kind: 'package-part',
      part: nonEmpty(record.part, `${path}.part`),
      ...(record.anchor === undefined ? {} : { anchor: nonEmpty(record.anchor, `${path}.anchor`) }),
    })
  }
  if (record.kind === 'page') {
    exact(record, path, ['kind', 'page'])
    return freeze({ kind: 'page', page: positive(record.page, `${path}.page`) })
  }
  if (record.kind === 'page-block') {
    optionalExact(record, path, ['kind', 'page', 'block'], ['start', 'end'])
    const start = record.start === undefined ? undefined : nonNegative(record.start, `${path}.start`)
    const end = record.end === undefined ? undefined : nonNegative(record.end, `${path}.end`)
    if ((start === undefined) !== (end === undefined) || (start !== undefined && start > end!)) {
      fail(path, 'page-block start and end must be an ordered pair')
    }
    return freeze({
      kind: 'page-block',
      page: positive(record.page, `${path}.page`),
      block: positive(record.block, `${path}.block`),
      ...(start === undefined ? {} : { start, end: end! }),
    })
  }
  if (record.kind === 'slide') {
    optionalExact(record, path, ['kind', 'slide'], ['block'])
    return freeze({
      kind: 'slide',
      slide: positive(record.slide, `${path}.slide`),
      ...(record.block === undefined ? {} : { block: positive(record.block, `${path}.block`) }),
    })
  }
  if (record.kind === 'sheet-range') {
    exact(record, path, ['kind', 'sheet', 'range'])
    return freeze({
      kind: 'sheet-range',
      sheet: nonEmpty(record.sheet, `${path}.sheet`),
      range: nonEmpty(record.range, `${path}.range`),
    })
  }
  if (record.kind === 'logical-table') {
    exact(record, path, ['kind', 'rowStart', 'rowEnd'])
    const rowStart = nonNegative(record.rowStart, `${path}.rowStart`)
    const rowEnd = nonNegative(record.rowEnd, `${path}.rowEnd`)
    if (rowEnd < rowStart) {
      fail(path, 'rowEnd must be at least rowStart')
    }
    return freeze({ kind: 'logical-table', rowStart, rowEnd })
  }
  if (record.kind === 'time') {
    exact(record, path, ['kind', 'unit', 'start', 'end'])
    const start = nonNegativeNumber(record.start, `${path}.start`)
    const end = nonNegativeNumber(record.end, `${path}.end`)
    if (record.unit !== 'seconds' || end < start) {
      fail(path, 'must be an ordered seconds interval')
    }
    return freeze({ kind: 'time', unit: 'seconds', start, end })
  }
  fail(`${path}.kind`, 'must be a supported coordinate kind')
}

function exact(value: unknown, path: string, keys: readonly string[]): RecordValue {
  const record = plain(value, path)
  if (!same(Object.keys(record), keys)) {
    fail(path, 'must contain exactly the declared keys')
  }
  return record
}

function optionalExact(
  record: RecordValue,
  path: string,
  required: readonly string[],
  optional: readonly string[],
): void {
  const allowed = new Set([...required, ...optional])
  if (!required.every((key) => Object.hasOwn(record, key)) || Object.keys(record).some((key) => !allowed.has(key))) {
    fail(path, 'must contain only declared keys and every required key')
  }
}

function plain(value: unknown, path: string): RecordValue {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.getOwnPropertySymbols(value).length > 0
  ) {
    fail(path, 'must be a plain record')
  }
  const result: RecordValue = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      fail(`${path}.${key}`, 'must not contain accessors or hidden properties')
    }
    result[key] = descriptor.value
  }
  return result
}

function array(value: unknown, path: string, parse: (value: unknown, path: string) => string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, 'must be a non-empty array')
  }
  return value.map((item, index) => parse(item, `${path}[${index}]`))
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(path, 'must be a string')
  }
  return value
}
function nonEmpty(value: unknown, path: string): string {
  const result = string(value, path)
  if (!result) {
    fail(path, 'must not be empty')
  }
  return result
}
function digest(value: unknown, path: string): string {
  const result = string(value, path)
  if (!SHA256.test(result)) {
    fail(path, 'must be a lowercase SHA-256 digest')
  }
  return result
}
function positive(value: unknown, path: string): number {
  const result = nonNegative(value, path)
  if (result < 1) {
    fail(path, 'must be positive')
  }
  return result
}
function nonNegative(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    fail(path, 'must be a non-negative integer')
  }
  return value
}
function nonNegativeNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(path, 'must be a non-negative number')
  }
  return value
}
function literal(value: unknown, expected: 2, path: string): 2 {
  if (value !== expected) {
    fail(path, `must equal ${expected}`)
  }
  return expected
}
function same(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.sort().every((key, index) => key === [...expected].sort()[index])
}
function freeze<T>(value: T): T {
  return Object.freeze(value)
}
function fail(path: string, message: string): never {
  throw new StoredEvidenceContractError(path, message)
}
