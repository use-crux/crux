import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluate } from '../../quality'
import { compareExperiments } from '../../quality/internal/compare'
import { experimentDiffSchema, experimentRecordSchema, failureArtifactSchema, toJsonSchema } from '../../quality/schemas'
import { runEvaluationWithRunner as run } from './runner-harness'

const qualityDir = () => mkdtemp(join(tmpdir(), 'crux-quality-schemas-'))

describe('@use-crux/core/quality/schemas', () => {
  it('parses persisted experiment records and exposes failure artifacts for failing cells', async () => {
    const dir = await qualityDir()
    const evaluation = evaluate('schemas.failure-artifact', {
      task: (input: { question: string }) => ({ answer: `wrong: ${input.question}` }),
      covers: ['prompt:support-answer'],
      data: [{ name: 'refund policy', input: { question: 'refunds?' }, expected: { answer: '30 days' } }],
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe(ctx.expected.answer)
      },
    })

    const experiment = await run(evaluation, undefined, { dir, persist: true })
    const recordPath = join(dir, 'experiments', `${experiment.experimentId}.json`)
    const rawRecord = JSON.parse(await readFile(recordPath, 'utf8')) as unknown

    const record = experimentRecordSchema.parse(rawRecord)
    expect(record.schemaVersion).toBe(2)
    expect(record.failures).toHaveLength(1)

    const failure = failureArtifactSchema.parse(record.failures[0])
    expect(failure).toMatchObject({
      caseId: 'refund-policy',
      caseName: 'refund policy',
      variant: 'default',
      trial: 0,
      phase: 'expect',
      input: { question: 'refunds?' },
      expected: { answer: '30 days' },
      output: { answer: 'wrong: refunds?' },
      covers: ['prompt:support-answer'],
    })
    expect(failure.failedOutcomes).toHaveLength(1)
    expect(failure.suggestedFixSurfaces).toContain('prompt')

    expect(() => experimentRecordSchema.parse({ ...record, cells: 'not cells' })).toThrow()
    expect(toJsonSchema('experiment')).toMatchObject({ type: 'object' })
  })

  it('parses experiment diff JSON and renders its JSON Schema', async () => {
    const dir = await qualityDir()
    const evaluation = evaluate('schemas.diff', {
      task: (input: { value: number }) => input.value,
      data: [{ input: { value: 1 }, expected: 1 }],
      expect: (ctx) => {
        ctx.expect(ctx.output).toBe(ctx.expected)
      },
    })

    const a = await run(evaluation, undefined, { dir, persist: true })
    const b = await run(evaluation, undefined, { dir, persist: true })
    const diff = experimentDiffSchema.parse(compareExperiments(a, b))

    expect(diff).toMatchObject({
      schemaVersion: 1,
      comparable: true,
      cases: [{ caseId: expect.any(String), variant: 'default' }],
    })
    expect(toJsonSchema('diff')).toMatchObject({ type: 'object' })
  })
})
