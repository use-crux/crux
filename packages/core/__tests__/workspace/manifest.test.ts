import { describe, expect, it } from 'vitest'
import { prompt } from '../../prompt/prompt'
import { inMemoryRecordStore } from '../../storage'
import { workspace } from '../../workspace'

describe('workspace manifest', () => {
  it('bounds listed files without exposing file contents', async () => {
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      records: inMemoryRecordStore(),
    })

    for (let index = 0; index < 500; index += 1) {
      await ws.write(`/workspace/file-${index}.md`, `secret content ${index}`)
    }

    const resolved = await prompt({
      id: 'analyst',
      use: [ws],
      system: 'Analyze.',
    }).resolve({})
    const listedPathCount = resolved.system.match(/\/workspace\/file-/g)?.length ?? 0

    expect(listedPathCount).toBeLessThan(500)
    expect(resolved.system).not.toContain('secret content 499')
  })
})
