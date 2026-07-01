import {
  describeBlobStoreConformance,
  describeRecordStoreConformance,
  describeVectorStoreConformance,
} from '@use-crux/core/storage/testing/vitest'
import { workspace } from '@use-crux/core/workspace'
import { describe, expect, it } from 'vitest'
import { convexRecordStore, convexVectorStore, convexWorkspaceBlobStore } from '../index'
import { createInMemoryConvexStoreDocumentComponent } from '../store-document-component'
import type { StoreDocDenseSearchQuery, StoreDocRecord } from '../store-doc'

describeRecordStoreConformance({
  name: 'convexRecordStore',
  prepare: () => {
    const component = createInMemoryConvexStoreDocumentComponent()
    return convexRecordStore({ component, ctx: component.ctx })
  },
})

describe('convexRecordStore workspace transactions', () => {
  it('supports staged multi-file workspace commits through the generic RecordStore contract', async () => {
    const component = createInMemoryConvexStoreDocumentComponent()
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      records: convexRecordStore({ component, ctx: component.ctx }),
    })

    await ws.transaction(async (tx) => {
      await tx.write('/outputs/report.md', '# Report')
      await tx.write('/outputs/data.csv', 'name,value\nalpha,1\n')
    })

    await expect(ws.read('/outputs/report.md')).resolves.toMatchObject({
      kind: 'text',
      content: '# Report',
    })
    await expect(ws.read('/outputs/data.csv')).resolves.toMatchObject({
      kind: 'text',
      content: 'name,value\nalpha,1\n',
    })
  })

  it('supports blob-backed workspace files with Convex storage helpers', async () => {
    const component = createInMemoryConvexStoreDocumentComponent()
    const blobs = new Map<string, Blob>()
    let counter = 0
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      storage: {
        records: convexRecordStore({ component, ctx: component.ctx }),
        blobs: convexWorkspaceBlobStore({
          ctx: {
            storage: {
              async store(blob) {
                counter += 1
                const id = `blob-${counter}`
                blobs.set(id, blob)
                return id
              },
              async get(id) {
                return blobs.get(id) ?? null
              },
              async delete(id) {
                blobs.delete(id)
              },
            },
          },
        }),
      },
    })

    await ws.transaction(async (tx) => {
      await tx.write('/outputs/report.bin', new Uint8Array([1, 2, 3]), {
        mimeType: 'application/octet-stream',
      })
    })

    const file = await ws.read('/outputs/report.bin')
    expect(file).toMatchObject({
      kind: 'binary',
      size: 3,
    })
    if (file.kind !== 'binary') throw new Error('expected binary file')
    expect(blobs.has(file.uri.slice('convex://'.length))).toBe(true)
  })
})

describeVectorStoreConformance({
  name: 'convexVectorStore',
  prepare: () => {
    const component = createInMemoryConvexStoreDocumentComponent({
      denseSearch: searchDenseDocs,
    })
    return convexVectorStore({ component, ctx: component.ctx })
  },
})

describeBlobStoreConformance({
  name: 'convexWorkspaceBlobStore',
  prepare: () => {
    const blobs = new Map<string, Blob>()
    let counter = 0
    return convexWorkspaceBlobStore({
      ctx: {
        storage: {
          async store(blob) {
            counter += 1
            const id = `blob-${counter}`
            blobs.set(id, blob)
            return id
          },
          async get(id) {
            return blobs.get(id) ?? null
          },
          async delete(id) {
            blobs.delete(id)
          },
        },
      },
    })
  },
})

function searchDenseDocs(query: StoreDocDenseSearchQuery, docs: readonly StoreDocRecord[]): readonly StoreDocRecord[] {
  return docs
    .flatMap((doc) => {
      const embedding = Array.isArray(doc.embedding) ? doc.embedding.filter(isNumber) : []
      const score = cosineSimilarity(query.vector, embedding)
      return score > 0 ? [{ ...doc, _score: score }] : []
    })
    .sort((left, right) => Number(right._score) - Number(left._score))
    .slice(0, query.limit)
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * (right[index] ?? 0)
    leftNorm += left[index] * left[index]
    rightNorm += (right[index] ?? 0) * (right[index] ?? 0)
  }
  const denominator = Math.sqrt(leftNorm) * Math.sqrt(rightNorm)
  return denominator === 0 ? 0 : dot / denominator
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
