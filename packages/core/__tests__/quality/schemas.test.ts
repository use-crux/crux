import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { dataset, evaluate } from '../../src/quality'
import { compareExperiments } from '../../src/quality/internal/compare'
import { experimentDiffSchema, experimentRecordSchema, failureArtifactSchema, toJsonSchema } from '../../src/quality/schemas'
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

  it('persists dataset provenance metadata and content fingerprint on dataset-backed failures', async () => {
    const dir = await qualityDir()
    const rootDir = await mkdtemp(join(tmpdir(), 'crux-quality-dataset-provenance-'))
    await mkdir(join(rootDir, 'evals/datasets'), { recursive: true })
    const datasetPath = 'evals/datasets/support.jsonl'
    const row = JSON.stringify({
      name: 'trace imported case',
      input: { question: 'refund?' },
      expected: { answer: '30 days' },
      metadata: {
        provenance: {
          traceId: 'trace_123',
          observedAt: '2026-07-08T12:00:00.000Z',
          source: 'trace-import',
        },
      },
    })
    await writeFile(join(rootDir, datasetPath), `${row}\n`, 'utf8')
    const contentFingerprint = createHash('sha256').update(`${row}\n`).digest('hex')

    const evaluation = evaluate('schemas.dataset-provenance', {
      task: (input: { question: string }) => ({ answer: `wrong: ${input.question}` }),
      data: dataset(datasetPath, {
        input: z.object({ question: z.string() }),
        expected: z.object({ answer: z.string() }),
      }),
      expect: (ctx) => {
        ctx.expect(ctx.output.answer).toBe(ctx.expected.answer)
      },
    })

    const experiment = await run(evaluation, undefined, { dir, rootDir, persist: true })
    const recordPath = join(dir, 'experiments', `${experiment.experimentId}.json`)
    const record = experimentRecordSchema.parse(JSON.parse(await readFile(recordPath, 'utf8')) as unknown)
    const cell = record.cells[0]!

    expect(cell.metadata?.datasetProvenance).toEqual({
      path: datasetPath,
      contentFingerprint,
      row: {
        traceId: 'trace_123',
        observedAt: '2026-07-08T12:00:00.000Z',
        source: 'trace-import',
      },
    })
    expect(record.failures?.[0]?.datasetProvenance).toEqual({
      path: datasetPath,
      contentFingerprint,
    })
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
