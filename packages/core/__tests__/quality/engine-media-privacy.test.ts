import { describe, expect, it } from 'vitest'
import { evaluate } from '../../src/quality'
import { runEvaluationWithRunner as run } from './runner-harness'

describe('Quality persisted media snapshots', () => {
  it('projects direct and nested assets/content parts before cells and failures are exposed', async () => {
    const { data, url, provider } = mediaFixtures()
    const evaluation = evaluate('media.snapshot.privacy', {
      task: async () => ({ direct: provider, nested: { parts: [{ type: 'image' as const, source: data }] } }),
      data: [{ input: { direct: data, nested: { asset: url } }, expected: { asset: provider } }],
      expect: (ctx) => ctx.expect(false).toBe(true),
    })

    const experiment = await run(evaluation)
    const rendered = JSON.stringify(experiment)

    expect(experiment.cells[0]?.input).toMatchObject({ direct: { kind: 'image', sourceCategory: 'data' } })
    expect(experiment.cells[0]?.output).toMatchObject({ direct: { kind: 'video', sourceCategory: 'provider-file' } })
    expect(experiment.failures?.[0]?.output).toEqual(experiment.cells[0]?.output)
    expect(rendered).not.toMatch(/91,92,93|private\.png|secret\.example|locator-secret|secret-provider|file-secret-123/)
  })
})

function mediaFixtures() {
  return {
    data: { type: 'data' as const, data: new Uint8Array([91, 92, 93]), mediaType: 'image/png', filename: 'private.png' },
    url: { type: 'url' as const, url: new URL('https://secret.example/image.png?token=locator-secret'), mediaType: 'image/png' },
    provider: { type: 'provider-file' as const, provider: 'secret-provider', fileId: 'file-secret-123', mediaType: 'video/mp4' },
  }
}
