import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LoadedQualityProject } from './quality-config'
import { discoverQualityInitTargets } from './quality-init'

const FIXTURE_ROOT = resolve(__dirname, '__fixtures__/quality-project')

describe('discoverQualityInitTargets', () => {
  it('discovers importable prompt exports and seeds the scaffold from authored tests', async () => {
    const sourceFile = resolve(FIXTURE_ROOT, 'crux.config.ts')
    const project = {
      quality: {},
      prompts: [],
      promptDiagnostics: [],
      configDir: FIXTURE_ROOT,
      configPath: sourceFile,
      configModule: {
        greeter: {
          _tag: 'Prompt',
          id: 'fixture.greeter',
          config: { tests: [{ input: { q: 'hi' } }] },
        },
      },
    } satisfies LoadedQualityProject

    const targets = discoverQualityInitTargets(project)

    expect(targets).toContainEqual({
      definitionId: 'prompt:fixture.greeter',
      kind: 'prompt',
      sourceFile,
      importName: 'greeter',
      taskExpression: 'greeter',
      sampleInput: { q: 'hi' },
    })
  })
})
