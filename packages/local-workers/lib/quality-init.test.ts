import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createProjectModelDefinitionId,
  createProjectModelRelationId,
  type ProjectModelField,
  type ResolvedProjectModel,
} from '@use-crux/core/project-index'
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

  it('prefers Project Model evidence and skips definitions already covered by evaluations', async () => {
    const sourceFile = resolve(FIXTURE_ROOT, 'crux.config.ts')
    const project = {
      quality: {},
      prompts: [],
      promptDiagnostics: [],
      configDir: FIXTURE_ROOT,
      configPath: sourceFile,
      configModule: {
        covered: {
          _tag: 'Prompt',
          id: 'fixture.covered',
          config: { tests: [{ input: { q: 'covered' } }] },
        },
        uncovered: {
          _tag: 'Prompt',
          id: 'fixture.uncovered',
          config: { tests: [{ input: { q: 'uncovered' } }] },
        },
      },
      projectModel: projectModelFixture(sourceFile),
    } satisfies LoadedQualityProject

    expect(discoverQualityInitTargets(project)).toEqual([
      {
        definitionId: 'prompt:fixture.uncovered',
        kind: 'prompt',
        sourceFile,
        importName: 'uncovered',
        taskExpression: 'uncovered',
        sampleInput: { q: 'uncovered' },
      },
    ])
  })
})

function projectModelFixture(sourceFile: string): ResolvedProjectModel {
  const source = { file: sourceFile, line: 1, column: 1 }
  return {
    root: field(FIXTURE_ROOT),
    configFiles: [],
    resolutionMode: field('source-only'),
    sourceRoots: [],
    ignoredPaths: [],
    quality: {
      persistenceRoot: field(resolve(FIXTURE_ROOT, '.crux/quality')),
      includeGlobs: [],
      excludeGlobs: [],
      evaluationFiles: [],
    },
    definitions: [
      {
        id: createProjectModelDefinitionId('prompt:fixture.covered'),
        kind: 'prompt',
        name: field('fixture.covered'),
        source,
        visibility: field('inferred', 'covered'),
      },
      {
        id: createProjectModelDefinitionId('prompt:fixture.uncovered'),
        kind: 'prompt',
        name: field('fixture.uncovered'),
        source,
        visibility: field('inferred', 'uncovered'),
      },
      {
        id: createProjectModelDefinitionId('evaluation:covered'),
        kind: 'evaluation',
        name: field('covered'),
        source,
        visibility: field('inferred', 'coveredEval'),
      },
    ],
    relations: [
      {
        id: createProjectModelRelationId('relation:covered'),
        type: 'eval.covers_definition',
        from: createProjectModelDefinitionId('evaluation:covered'),
        to: createProjectModelDefinitionId('prompt:fixture.covered'),
        visibility: field('inferred', 'coveredEval'),
      },
    ],
    diagnostics: [],
  }
}

function field<T>(value: T, exportName?: string): ProjectModelField<T> {
  return {
    value,
    provenance: { kind: 'source', file: resolve(FIXTURE_ROOT, 'crux.config.ts'), ...(exportName ? { exportName } : {}) },
  }
}
