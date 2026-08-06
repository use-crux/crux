import { vi } from 'vitest'

interface SparseVector {
  readonly indices: readonly number[]
  readonly values: readonly number[]
}

interface FakeSearchRecord {
  id: string
  vector?: number[]
  sparseVector?: SparseVector
  metadata?: Record<string, unknown>
}

export function createFakeUpstashSearchIndex() {
  const records = new Map<string, FakeSearchRecord>()
  const namespace = {
    upsert: vi.fn(async (input: unknown) => {
      for (const record of normalizeSearchUpserts(input)) {
        records.set(record.id, record)
      }
    }),
    query: vi.fn(async (input: unknown) => queryRecords(records, input)),
    delete: vi.fn(async (input: unknown) => {
      const ids = Array.isArray(input) ? input : [input]
      for (const id of ids) {
        records.delete(String(id))
      }
    }),
  }
  const index = {
    namespace: vi.fn(() => namespace),
    upsert: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
  }
  return { index, namespace }
}

function normalizeSearchUpserts(input: unknown): FakeSearchRecord[] {
  const records = Array.isArray(input) ? input : [input]
  return records.flatMap((record) => {
    if (!record || typeof record !== 'object') return []
    const candidate = record as { id?: unknown; vector?: unknown; sparseVector?: unknown; metadata?: unknown }
    if (typeof candidate.id !== 'string') return []
    return [
      {
        id: candidate.id,
        vector: Array.isArray(candidate.vector) ? candidate.vector.filter(isNumber) : undefined,
        sparseVector: isSparseVector(candidate.sparseVector) ? candidate.sparseVector : undefined,
        metadata:
          candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
            ? (candidate.metadata as Record<string, unknown>)
            : undefined,
      },
    ]
  })
}

function queryRecords(records: Map<string, FakeSearchRecord>, input: unknown) {
  if (!input || typeof input !== 'object') return []
  const query = input as { vector?: unknown; sparseVector?: unknown; topK?: unknown; filter?: unknown }
  const topK = typeof query.topK === 'number' ? query.topK : 10
  const filter = typeof query.filter === 'string' ? query.filter : undefined
  if (Array.isArray(query.vector)) {
    const vector = query.vector.filter(isNumber)
    return [...records.values()]
      .filter((record) => record.vector && matchesSearchFilter(record.metadata, filter))
      .map((record) => ({
        id: record.id,
        score: cosineSimilarity(vector, record.vector ?? []),
        metadata: record.metadata,
      }))
      .sort(compareScores)
      .slice(0, topK)
  }
  if (isSparseVector(query.sparseVector)) {
    return [...records.values()]
      .filter((record) => record.sparseVector && matchesSearchFilter(record.metadata, filter))
      .map((record) => ({
        id: record.id,
        score: sparseDotProduct(query.sparseVector as SparseVector, record.sparseVector),
        metadata: record.metadata,
      }))
      .sort(compareScores)
      .slice(0, topK)
  }
  return []
}

function compareScores(a: { readonly id: string; readonly score: number }, b: { readonly id: string; readonly score: number }) {
  return b.score - a.score || a.id.localeCompare(b.id)
}

function matchesSearchFilter(metadata: Record<string, unknown> | undefined, filter: string | undefined): boolean {
  if (!filter) return true
  if (!metadata) return false
  return filter.split(' and ').every((clause) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*) = (.+)$/.exec(clause)
    if (!match) return true
    return metadata[match[1]] === decodeFilterLiteral(match[2])
  })
}

function decodeFilterLiteral(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
  return value
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] * a[index]
    normB += b[index] * b[index]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dot / denominator
}

function sparseDotProduct(a: SparseVector, b: SparseVector | undefined): number {
  if (!b) return 0
  let score = 0
  for (let index = 0; index < a.indices.length; index += 1) {
    const bIndex = b.indices.indexOf(a.indices[index])
    if (bIndex >= 0) score += a.values[index] * b.values[bIndex]
  }
  return score
}

function isSparseVector(value: unknown): value is SparseVector {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { readonly indices?: unknown; readonly values?: unknown }
  return Array.isArray(candidate.indices) && Array.isArray(candidate.values)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}
