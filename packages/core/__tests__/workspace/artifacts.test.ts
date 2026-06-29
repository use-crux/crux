import { describe, expect, it, vi } from 'vitest'
import { inMemoryBlobStore, inMemoryDataStore, storage } from '../../storage'
import { workspace } from '../../workspace'
import { observe } from '../../observability'
import { prompt } from '../../prompt'

describe('workspace artifacts facet', () => {
  it('writes artifact status and kind metadata visible through stat and read', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:default',
      data: inMemoryDataStore(),
    })

    const written = await ws.write('/outputs/report.md', '# Report', {
      status: 'draft',
      kind: 'report',
      mimeType: 'text/markdown',
    })

    expect(written).toMatchObject({
      path: '/outputs/report.md',
      status: 'draft',
      artifactKind: 'report',
    })
    await expect(ws.stat('/outputs/report.md')).resolves.toMatchObject({
      status: 'draft',
      artifactKind: 'report',
    })
    await expect(ws.read('/outputs/report.md')).resolves.toMatchObject({
      kind: 'text',
      status: 'draft',
      artifactKind: 'report',
      content: '# Report',
    })
  })

  it('finalizes a draft file as an artifact', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:default',
      data: inMemoryDataStore(),
    })

    await ws.write('/outputs/report.md', '# Report', {
      status: 'draft',
      kind: 'report',
      mimeType: 'text/markdown',
    })

    const artifact = await ws.finalize('/outputs/report.md')

    expect(artifact).toMatchObject({
      path: '/outputs/report.md',
      status: 'final',
      kind: 'report',
      mimeType: 'text/markdown',
      size: 8,
    })
    await expect(ws.stat('/outputs/report.md')).resolves.toMatchObject({
      status: 'final',
      artifactKind: 'report',
    })
  })

  it('queries artifacts by status and kind through store filters', async () => {
    const data = inMemoryDataStore()
    const listSpy = vi.spyOn(data, 'list')
    const ws = workspace({
      id: 'research',
      namespace: 'thread:default',
      data,
    })

    await ws.write('/outputs/draft.md', 'Draft', { status: 'draft', kind: 'report' })
    await ws.write('/outputs/final.md', 'Final', { status: 'final', kind: 'report' })
    await ws.write('/outputs/chart.json', { points: [1, 2] }, { status: 'final', kind: 'chart' })
    await ws.write('/workspace/notes.md', 'Not an artifact')

    await expect(ws.artifacts({ status: 'final' })).resolves.toMatchObject([
      { path: '/outputs/chart.json', status: 'final', kind: 'chart' },
      { path: '/outputs/final.md', status: 'final', kind: 'report' },
    ])
    await expect(ws.artifacts({ kind: 'report' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/outputs/final.md', kind: 'report' }),
        expect.objectContaining({ path: '/outputs/draft.md', kind: 'report' }),
      ]),
    )
    expect(listSpy).toHaveBeenCalledWith(expect.any(String), { filter: { status: 'final' } })
    expect(listSpy).toHaveBeenCalledWith(expect.any(String), { filter: { kind: 'report' } })
  })

  it('returns download references for blob and inline artifacts', async () => {
    const blobs = inMemoryBlobStore()
    const ws = workspace({
      id: 'research',
      namespace: 'thread:default',
      storage: storage({ data: inMemoryDataStore(), blobs }),
    })

    await ws.write('/outputs/report.pdf', new Uint8Array([1, 2, 3]), {
      status: 'draft',
      kind: 'pdf',
      mimeType: 'application/pdf',
    })
    await ws.write('/outputs/summary.md', 'Summary', {
      status: 'draft',
      kind: 'summary',
      mimeType: 'text/markdown',
    })

    const binary = await ws.finalize('/outputs/report.pdf')
    const inline = await ws.finalize('/outputs/summary.md')

    expect(binary.uri).toMatch(/^memory:\/\//)
    await expect(blobs.get(binary.uri ?? '')).resolves.toMatchObject({
      mimeType: 'application/pdf',
      size: 3,
    })
    expect(inline.uri).toBe('workspace-inline://research/thread%3Adefault/outputs/summary.md')
  })

  it('records provenance from the caller observability context when present', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:default',
      data: inMemoryDataStore(),
    })

    await ws.write('/outputs/no-span.md', 'No span', { status: 'draft', kind: 'note' })
    await expect(ws.stat('/outputs/no-span.md')).resolves.not.toHaveProperty('producedBy')

    const run = observe.openRun({ name: 'artifact run', rootPrimitive: 'custom.operation' })
    await run.withContext(async () => {
      await observe.span({ name: 'producer', family: 'custom', primitive: 'custom.operation' }, async () => {
        await ws.write('/outputs/with-span.md', 'With span', { status: 'draft', kind: 'note' })
      })
    })
    run.end()

    const produced = await ws.stat('/outputs/with-span.md')
    expect(produced?.producedBy).toMatchObject({
      runId: run.runId,
    })
    expect(produced?.producedBy?.spanId).toMatch(/^span_/)
  })

  it('surfaces final artifacts in the manifest without contents', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:default',
      data: inMemoryDataStore(),
    })

    await ws.write('/outputs/report.md', 'private report', { status: 'draft', kind: 'report' })
    await ws.finalize('/outputs/report.md')
    await ws.write('/outputs/wip.md', 'private draft', { status: 'draft', kind: 'report' })

    const resolved = await prompt({
      id: 'analyst',
      use: [ws],
      system: 'Analyze.',
    }).resolve({})

    expect(resolved.system).toContain('Final artifacts:')
    expect(resolved.system).toContain('/outputs/report.md (report, text/plain, 14 bytes)')
    expect(resolved.system).not.toContain('/outputs/wip.md (report')
    expect(resolved.system).not.toContain('private report')
  })
})
