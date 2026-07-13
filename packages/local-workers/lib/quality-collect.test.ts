import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prompt } from '@use-crux/core'
import * as runnerCore from '@use-crux/core/quality/internal/runner'
import {
  loadQualityProject,
  resolveQualityRunnerSettings,
} from './quality-config'
import {
  collectEvaluationFiles,
  collectPromptTests,
  deriveEvaluationId,
  findDuplicateIdErrors,
} from './quality-collect'

const FIXTURE_ROOT = resolve(__dirname, '__fixtures__/quality-collect')

describe('deriveEvaluationId', () => {
  it('derives the id from the POSIX relative path, stripping the compound eval suffix', () => {
    expect(deriveEvaluationId('evals/support/refunds.eval.ts', 'default')).toBe(
      'evals.support.refunds',
    )
  })

  it('appends #exportName for non-default exports', () => {
    expect(
      deriveEvaluationId('evals/support/refunds.eval.ts', 'edgeCases'),
    ).toBe('evals.support.refunds#edgeCases')
  })

  it('strips only the final extension for files without an .eval suffix', () => {
    expect(deriveEvaluationId('checks/smoke.ts', 'default')).toBe(
      'checks.smoke',
    )
  })

  it('handles Windows-style separators by normalizing to POSIX first', () => {
    expect(
      deriveEvaluationId('evals\\support\\refunds.eval.ts', 'default'),
    ).toBe('evals.support.refunds')
  })
})

describe('collectEvaluationFiles', () => {
  it('collects file evaluations from a no-config project with an empty prompt registry', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'crux-quality-collect-'))
    symlinkSync(
      resolve(__dirname, '../node_modules'),
      join(projectRoot, 'node_modules'),
      'dir',
    )
    const evalRoot = join(projectRoot, 'evals')
    mkdirSync(evalRoot, { recursive: true })
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify({ name: '@acme/no-config-collect' }),
    )
    writeFileSync(
      join(evalRoot, 'no-config.eval.ts'),
      `
import { evaluate } from '@use-crux/core/quality'

export default evaluate({
  task: (input: { value: string }) => input.value,
  data: [{ input: { value: 'visible from source' } }],
})
`,
    )

    const previousCwd = process.cwd()
    try {
      process.chdir(evalRoot)
      const project = await loadQualityProject()
      const settings = resolveQualityRunnerSettings(
        project.quality,
        project.configDir,
      )
      const fromFiles = await collectEvaluationFiles({
        rootDir: project.configDir,
        include: settings.include,
        exclude: settings.exclude,
      })
      const fromPrompts = await collectPromptTests(project.prompts, runnerCore)

      expect(project.configPath).toBeUndefined()
      expect(project.prompts).toEqual([])
      expect(fromPrompts).toEqual({ evaluations: [], errors: [] })
      expect(fromFiles.errors).toEqual([])
      expect(fromFiles.evaluations.map((entry) => entry.id)).toEqual([
        'evals.no-config',
      ])
    } finally {
      process.chdir(previousCwd)
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('deduplicates files matched by both default convention globs', async () => {
    const projectRoot = mkdtempSync(join(FIXTURE_ROOT, 'dedupe-project-'))
    const evalRoot = join(projectRoot, 'evals')
    mkdirSync(evalRoot, { recursive: true })
    writeFileSync(
      join(evalRoot, 'overlap.eval.ts'),
      `
import { evaluate } from '@use-crux/core/quality'

export default evaluate({
  task: (input: { value: string }) => input.value,
  data: [{ input: { value: 'seen once' } }],
})
`,
    )

    try {
      const result = await collectEvaluationFiles({
        rootDir: projectRoot,
        include: ['evals/**/*.eval.ts', '**/*.eval.ts'],
      })

      expect(result.errors).toEqual([])
      expect(result.evaluations.map((entry) => entry.file)).toEqual([
        'evals/overlap.eval.ts',
      ])
      expect(result.evaluations.map((entry) => entry.id)).toEqual([
        'evals.overlap',
      ])
    } finally {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  it('discovers a default-export evaluation and fills its manifest collect fields', async () => {
    const result = await collectEvaluationFiles({
      rootDir: FIXTURE_ROOT,
      include: 'evals/greeting.eval.ts',
    })

    expect(result.errors).toEqual([])
    expect(result.evaluations).toHaveLength(1)
    const [greeting] = result.evaluations
    expect(greeting!.id).toBe('evals.greeting')
    expect(greeting!.explicitId).toBe(false)
    expect(greeting!.file).toBe('evals/greeting.eval.ts')
    expect(greeting!.exportName).toBe('default')
    expect(greeting!.source).toBe('file')
    expect(greeting!.manifest.id).toBe('evals.greeting')
    expect(greeting!.manifest.explicitId).toBe(false)
    expect(greeting!.manifest.file).toBe('evals/greeting.eval.ts')
    expect(greeting!.manifest.exportName).toBe('default')
    expect(greeting!.manifest.cases).toHaveLength(2)
  })

  it('collects named exports with #suffix ids, keeps explicit ids, and ignores non-evaluations', async () => {
    const result = await collectEvaluationFiles({
      rootDir: FIXTURE_ROOT,
      include: 'evals/multi.eval.ts',
    })

    expect(result.errors).toEqual([])
    const byId = new Map(result.evaluations.map((entry) => [entry.id, entry]))
    expect([...byId.keys()].sort()).toEqual([
      'evals.multi#alpha',
      'support.pinned',
    ])
    expect(byId.get('evals.multi#alpha')!.explicitId).toBe(false)
    expect(byId.get('evals.multi#alpha')!.exportName).toBe('alpha')
    expect(byId.get('support.pinned')!.explicitId).toBe(true)
    expect(byId.get('support.pinned')!.manifest.id).toBe('support.pinned')
    expect(byId.get('support.pinned')!.manifest.exportName).toBe('pinned')
  })

  it('reports a thenable export as an async-at-collect definition error', async () => {
    const result = await collectEvaluationFiles({
      rootDir: FIXTURE_ROOT,
      include: 'bad/async.eval.ts',
    })

    expect(result.evaluations).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toMatch(/async/i)
    expect(result.errors[0]!.file).toBe('bad/async.eval.ts')
  })

  it('reports a failing import as a collect error and keeps collecting', async () => {
    const result = await collectEvaluationFiles({
      rootDir: FIXTURE_ROOT,
      include: ['bad/throws.eval.ts', 'evals/greeting.eval.ts'],
    })

    expect(result.evaluations.map((entry) => entry.id)).toEqual([
      'evals.greeting',
    ])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toContain('boom at import time')
    expect(result.errors[0]!.file).toBe('bad/throws.eval.ts')
  })
})

describe('collectPromptTests', () => {
  it('lowers prompts with colocated tests into prompt:<id> evaluations', async () => {
    const tested = prompt({
      id: 'support.greet',
      system: 'greet',
      tests: [{ input: { q: 'hi' } }],
    })
    const untested = prompt({ id: 'support.plain', system: 'plain' })

    const result = await collectPromptTests([tested, untested], runnerCore)

    expect(result.errors).toEqual([])
    expect(result.evaluations).toHaveLength(1)
    const [lowered] = result.evaluations
    expect(lowered!.id).toBe('prompt:support.greet')
    expect(lowered!.explicitId).toBe(true)
    expect(lowered!.source).toBe('prompt-tests')
    expect(lowered!.file).toBe('')
    expect(lowered!.exportName).toBe('')
    expect(lowered!.manifest.id).toBe('prompt:support.greet')
    expect(lowered!.manifest.source).toBe('prompt-tests')
  })

  it('reports a lowering failure (prompt without id) as a collect error', async () => {
    const anonymous = prompt({
      system: 'anon',
      tests: [{ input: { q: 'x' } }],
    })

    const result = await collectPromptTests([anonymous], runnerCore)

    expect(result.evaluations).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toMatch(/id/)
  })
})

describe('findDuplicateIdErrors', () => {
  it('flags the same resolved id appearing in two files', async () => {
    const result = await collectEvaluationFiles({
      rootDir: FIXTURE_ROOT,
      include: 'dups/*.eval.ts',
    })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.message).toContain('dup.id')
    const duplicates = findDuplicateIdErrors(result.evaluations)
    expect(duplicates).toHaveLength(1)
    expect(duplicates[0]!.message).toContain('dup.id')
    expect(duplicates[0]!.message).toContain('dups/a.eval.ts')
    expect(duplicates[0]!.message).toContain('dups/b.eval.ts')
  })

  it('reports nothing for unique ids', async () => {
    const result = await collectEvaluationFiles({
      rootDir: FIXTURE_ROOT,
      include: 'evals/*.eval.ts',
    })

    expect(findDuplicateIdErrors(result.evaluations)).toEqual([])
  })
})
