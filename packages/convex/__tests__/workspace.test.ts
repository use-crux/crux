import { describe, expect, it, vi } from 'vitest'
import { convexWorkspaceBlobStore } from '../workspace'

describe('convexWorkspaceBlobStore', () => {
  it('stores and reads blobs through ctx.storage', async () => {
    const stored = new Map<string, Blob>()
    const storage = {
      store: vi.fn(async (blob: Blob) => {
        stored.set('blob-1', blob)
        return 'blob-1'
      }),
      get: vi.fn(async (id: string) => stored.get(id) ?? null),
      delete: vi.fn(async (id: string) => {
        stored.delete(id)
      }),
    }

    const blobs = convexWorkspaceBlobStore({ ctx: { storage } })
    const ref = await blobs.put({
      key: 'research/thread:1/outputs/report.pdf',
      content: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
      metadata: { workspaceId: 'research' },
    })

    expect(ref).toEqual({ uri: 'convex://blob-1', size: 3 })
    expect(storage.store).toHaveBeenCalledWith(expect.any(Blob))
    await expect(stored.get('blob-1')?.arrayBuffer()).resolves.toEqual(new Uint8Array([1, 2, 3]).buffer)
    await expect(blobs.get(ref.uri)).resolves.toMatchObject({
      mimeType: 'application/pdf',
      size: 3,
    })

    await blobs.delete?.(ref.uri)
    expect(storage.delete).toHaveBeenCalledWith('blob-1')
  })

  it('throws clearly when get is unavailable in the current Convex runtime', async () => {
    const blobs = convexWorkspaceBlobStore({
      ctx: {
        storage: {
          store: vi.fn(async () => 'blob-1'),
        },
      },
    })

    await expect(blobs.get('convex://blob-1')).rejects.toThrow(/requires ctx.storage.get/i)
  })
})
