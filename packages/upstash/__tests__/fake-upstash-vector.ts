import { vi } from 'vitest'

interface FakeVectorRecord {
  id: string
  vector?: number[]
  metadata?: Record<string, unknown>
}

export function createFakeUpstashVectorIndex() {
  const vectors = new Map<string, FakeVectorRecord>()
  const namespace = {
    upsert: vi.fn(async (input: unknown) => {
      for (const record of normalizeVectorUpserts(input)) {
        vectors.set(record.id, record)
      }
    }),
    query: vi.fn(async (input: unknown) => queryVectors(vectors, input)),
    delete: vi.fn().mockResolvedValue(undefined),
  }
  const index = {
    namespace: vi.fn(() => namespace),
    upsert: vi.fn(),
    query: vi.fn(),
    delete: vi.fn(),
  }
  return { index, namespace }
}

function normalizeVectorUpserts(input: unknown): FakeVectorRecord[] {
  const records = Array.isArray(input) ? input : [input]
  return records.flatMap((record) => {
    if (!record || typeof record !== 'object') return []
    const candidate = record as { id?: unknown; vector?: unknown; metadata?: unknown }
    if (typeof candidate.id !== 'string') return []
    return [
      {
        id: candidate.id,
        vector: Array.isArray(candidate.vector) ? candidate.vector.filter(isNumber) : undefined,
        metadata:
          candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
            ? (candidate.metadata as Record<string, unknown>)
            : undefined,
      },
    ]
  })
}

function queryVectors(vectors: Map<string, FakeVectorRecord>, input: unknown) {
  if (!input || typeof input !== 'object') return []
  const query = input as { vector?: unknown; topK?: unknown; filter?: unknown }
  if (!Array.isArray(query.vector)) return []
  const vector = query.vector.filter(isNumber)
  const topK = typeof query.topK === 'number' ? query.topK : 10
  const filter = typeof query.filter === 'string' ? query.filter : undefined

  return [...vectors.values()]
    .filter((record) => record.vector && matchesVectorFilter(record.metadata, filter))
    .map((record) => ({
      id: record.id,
      score: cosineSimilarity(vector, record.vector ?? []),
      metadata: record.metadata,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
}

function matchesVectorFilter(metadata: Record<string, unknown> | undefined, filter: string | undefined): boolean {
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

function isNumber(value: unknown): value is number {
  return typeof value === 'number'
}
