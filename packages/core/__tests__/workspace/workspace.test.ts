import { describe, expect, it, vi } from 'vitest'
import { prompt } from '../../prompt/prompt'
import { inMemoryBlobStore, inMemoryDataStore, storage } from '../../storage'
import { workspace, workspaceToolNames } from '../../workspace'
import { resetRuntime, setRuntime } from '../../runtime'

describe('workspace()', () => {
  it('creates default /workspace and /outputs mounts', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      storage: storage({ data: inMemoryDataStore(), blobs: inMemoryBlobStore() }),
    })

    const listing = await ws.list('/')

    expect(ws._tag).toBe('Workspace')
    expect(Object.isFrozen(ws)).toBe(true)
    expect(listing.entries.map((entry) => entry.path)).toEqual(['/outputs', '/workspace'])
  })

  it('rejects traversal and paths outside configured mounts before storage access', async () => {
    const data = inMemoryDataStore()
    const setSpy = vi.spyOn(data, 'set')
    const ws = workspace({ id: 'research', namespace: 'thread:1', data })

    await expect(ws.write('/workspace/../secret.md', 'nope')).rejects.toThrow(/path traversal/i)
    await expect(ws.write('/sources/source.md', 'nope')).rejects.toThrow(/outside configured workspace mounts/i)
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('round-trips inline text through the store', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      storage: storage({ data: inMemoryDataStore(), blobs: inMemoryBlobStore() }),
    })

    await ws.write('/workspace/notes.md', '# Notes', { mimeType: 'text/markdown' })
    const file = await ws.read('/workspace/notes.md')

    expect(file).toMatchObject({
      kind: 'text',
      path: '/workspace/notes.md',
      mimeType: 'text/markdown',
      content: '# Notes',
      size: 7,
    })
  })

  it('lists directories and simple globs', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      storage: storage({ data: inMemoryDataStore(), blobs: inMemoryBlobStore() }),
    })

    await ws.write('/workspace/notes.md', 'notes')
    await ws.write('/workspace/nested/brief.md', 'brief')
    await ws.write('/outputs/report.pdf', new Uint8Array([1, 2, 3]), { mimeType: 'application/pdf' })

    await expect(ws.list('/workspace')).resolves.toMatchObject({
      entries: [{ path: '/workspace/nested' }, { path: '/workspace/notes.md' }],
    })
    await expect(ws.list('/workspace/**/*.md')).resolves.toMatchObject({
      entries: [{ path: '/workspace/nested/brief.md' }],
    })
    await expect(ws.list('/outputs/*.pdf')).resolves.toMatchObject({
      entries: [{ path: '/outputs/report.pdf' }],
    })
  })

  it('stores binary content in blobs and keeps metadata in the store', async () => {
    const data = inMemoryDataStore()
    const blobs = inMemoryBlobStore()
    const ws = workspace({ id: 'research', namespace: 'thread:1', storage: storage({ data, blobs }) })

    await ws.write('/outputs/report.pdf', new Uint8Array([1, 2, 3]), { mimeType: 'application/pdf' })
    const file = await ws.read('/outputs/report.pdf')

    expect(file).toMatchObject({
      kind: 'binary',
      path: '/outputs/report.pdf',
      mimeType: 'application/pdf',
      size: 3,
    })
    expect(file.kind === 'binary' ? file.uri : '').toMatch(/^memory:\/\//)
    await expect(blobs.get(file.kind === 'binary' ? file.uri : '')).resolves.toMatchObject({
      mimeType: 'application/pdf',
      size: 3,
    })
  })

  it('throws clearly when binary content is written without a blob store', async () => {
    const ws = workspace({ id: 'research', namespace: 'thread:1', data: inMemoryDataStore() })

    await expect(ws.write('/outputs/report.pdf', new Uint8Array([1]), { mimeType: 'application/pdf' })).rejects.toThrow(
      /WorkspaceBlobStore/,
    )
  })

  it('renders manifest context without dumping file contents', async () => {
    const ws = workspace({ id: 'research', namespace: 'thread:1', data: inMemoryDataStore() })
    await ws.write('/workspace/notes.md', 'private notes')

    const resolved = await prompt({
      id: 'analyst',
      use: [ws],
      system: 'Analyze.',
    }).resolve({})

    expect(resolved.system).toContain('## Workspace (research)')
    expect(resolved.system).toContain('/workspace/notes.md')
    expect(resolved.system).not.toContain('private notes')
  })

  it('injects default tools and omits delete by default', async () => {
    const ws = workspace({ id: 'research', namespace: 'thread:1', data: inMemoryDataStore() })
    const resolved = await prompt({
      id: 'analyst',
      use: [ws],
      system: 'Analyze.',
    }).resolve({})

    expect(Object.keys(resolved.tools ?? {}).sort()).toEqual([
      'editWorkspaceFile',
      'listWorkspace',
      'readWorkspaceFile',
      'writeWorkspaceFile',
    ])
  })

  it('binds injected tools to the same dynamic namespace as the manifest', async () => {
    const ws = workspace({
      id: 'research',
      namespace: ({ input }) => {
        const threadId = input.threadId
        if (typeof threadId !== 'string') throw new Error('threadId is required')
        return `thread:${threadId}`
      },
      data: inMemoryDataStore(),
    })
    const resolved = await prompt({
      id: 'analyst',
      use: [ws],
      system: 'Analyze.',
    }).resolve({ input: { threadId: 'alpha' } })

    await resolved.tools?.writeWorkspaceFile?.execute?.({
      path: '/workspace/notes.md',
      content: 'alpha notes',
    })
    const read = await resolved.tools?.readWorkspaceFile?.execute?.({
      path: '/workspace/notes.md',
    })

    expect(resolved.system).toContain('Namespace: thread:alpha')
    expect(read).toMatchObject({
      kind: 'text',
      content: 'alpha notes',
    })
  })

  it('supports prefixed tools and delete opt-in', () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      data: inMemoryDataStore(),
      tools: { prefix: 'research', delete: true },
    })

    expect(Object.keys(ws.asTools()).sort()).toEqual([
      'deleteResearchWorkspaceFile',
      'editResearchWorkspaceFile',
      'listResearchWorkspace',
      'readResearchWorkspaceFile',
      'writeResearchWorkspaceFile',
    ])
    expect(workspaceToolNames({ prefix: 'research' })).toMatchObject({
      deleteFile: 'deleteResearchWorkspaceFile',
      writeFile: 'writeResearchWorkspaceFile',
    })
  })

  it('throws on multiple unprefixed workspace injections', async () => {
    const data = inMemoryDataStore()
    const one = workspace({ id: 'one', namespace: 'thread:1', data })
    const two = workspace({ id: 'two', namespace: 'thread:1', data })

    await expect(
      prompt({
        id: 'analyst',
        use: [one, two],
        system: 'Analyze.',
      }).resolve({}),
    ).rejects.toThrow(/tool name collision/i)
  })

  it('emits workspace operation instrumentation', async () => {
    const onWorkspaceOperation = vi.fn()
    setRuntime({ instrumentationHooks: { onWorkspaceOperation } })
    const ws = workspace({ id: 'research', namespace: 'thread:1', data: inMemoryDataStore() })

    try {
      await ws.write('/workspace/notes.md', 'notes')
      await ws.read('/workspace/notes.md')
    } finally {
      resetRuntime()
    }

    expect(onWorkspaceOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'research',
        namespace: 'thread:1',
        operation: 'write',
        path: '/workspace/notes.md',
        status: 'success',
      }),
    )
    expect(onWorkspaceOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'read',
        status: 'success',
      }),
    )
  })
})
