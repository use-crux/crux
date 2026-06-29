import { describe, expect, it } from 'vitest'
import { prompt } from '../../prompt/prompt'
import { inMemoryDataStore } from '../../storage'
import { workspace } from '../../workspace'

describe('workspace namespace overrides', () => {
  function dynamicWorkspace() {
    return workspace({
      id: 'research',
      namespace: ({ input }) => {
        const threadId = input.threadId
        if (typeof threadId !== 'string') throw new Error('threadId is required')
        return `thread:${threadId}`
      },
      data: inMemoryDataStore(),
    })
  }

  it('uses an explicit namespace override for direct method calls', async () => {
    const ws = dynamicWorkspace()

    await ws.write('/workspace/a.md', 'hi', { namespace: 'thread:x' })
    const result = await ws.read('/workspace/a.md', { namespace: 'thread:x' })

    expect(result).toMatchObject({
      kind: 'text',
      content: 'hi',
    })
  })

  it('uses an explicit namespace override for manually created tools', async () => {
    const ws = dynamicWorkspace()
    const tools = ws.asTools({ namespace: 'thread:x' })

    await tools.writeWorkspaceFile.execute?.({
      path: '/workspace/a.md',
      content: 'hi',
    })
    const result = await ws.read('/workspace/a.md', { namespace: 'thread:x' })

    expect(result).toMatchObject({
      kind: 'text',
      content: 'hi',
    })
  })

  it('uses a static namespace when no override is supplied', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:static',
      data: inMemoryDataStore(),
    })

    await ws.write('/workspace/a.md', 'static')
    const result = await ws.read('/workspace/a.md')

    expect(result).toMatchObject({
      kind: 'text',
      content: 'static',
    })
  })

  it('binds injected tools and manifest to the resolved dynamic namespace', async () => {
    const ws = dynamicWorkspace()
    const resolved = await prompt({
      id: 'analyst',
      use: [ws],
      system: 'Analyze.',
    }).resolve({ input: { threadId: 'alpha' } })

    await resolved.tools?.writeWorkspaceFile?.execute?.({
      path: '/workspace/a.md',
      content: 'alpha',
    })
    const result = await resolved.tools?.readWorkspaceFile?.execute?.({
      path: '/workspace/a.md',
    })

    expect(resolved.system).toContain('Namespace: thread:alpha')
    expect(result).toMatchObject({
      kind: 'text',
      content: 'alpha',
    })
  })

  it('accepts JSON arrays and scalars in the write tool schema', () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:static',
      data: inMemoryDataStore(),
    })
    const writeTool = ws.asTools().writeWorkspaceFile

    expect(writeTool.parameters.safeParse({ path: '/workspace/list.json', content: ['a', 1, true] }).success).toBe(true)
    expect(writeTool.parameters.safeParse({ path: '/workspace/count.json', content: 1 }).success).toBe(true)
    expect(writeTool.parameters.safeParse({ path: '/workspace/enabled.json', content: false }).success).toBe(true)
    expect(writeTool.parameters.safeParse({ path: '/workspace/empty.json', content: null }).success).toBe(true)
  })
})
