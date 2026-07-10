import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxArtifactRecord,
  type CruxEdgeRecord,
  type CruxRunStartRecord,
} from '../../src/observability'
import { evaluate } from '../../src/quality'
import { createQualityRunner } from '../../src/quality/internal/runner'

const upperTask = async (input: { q: string }) => ({
  answer: input.q.toUpperCase(),
})

afterEach(() => {
  resetObservabilityRuntime()
})

function artifactRecords(records: readonly unknown[]): CruxArtifactRecord[] {
  return records.filter((record): record is CruxArtifactRecord => {
    return (
      typeof record === 'object' &&
      record !== null &&
      (record as { type?: unknown }).type === 'artifact'
    )
  })
}

function edgeRecords(records: readonly unknown[]): CruxEdgeRecord[] {
  return records.filter((record): record is CruxEdgeRecord => {
    return (
      typeof record === 'object' &&
      record !== null &&
      (record as { type?: unknown }).type === 'edge'
    )
  })
}

function runStarts(records: readonly unknown[]): CruxRunStartRecord[] {
  return records.filter((record): record is CruxRunStartRecord => {
    return (
      typeof record === 'object' &&
      record !== null &&
      (record as { type?: unknown }).type === 'run:start'
    )
  })
}

describe('Quality runner observability operations', () => {
  it('emits a baseline.promotion artifact linked to the promoted eval run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crux-runner-observability-'))
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const evaluation = evaluate('runner.promote.observability', {
      task: upperTask,
      data: [{ input: { q: 'ok' } }],
    })
    const runner = createQualityRunner({
      dir,
      rootDir: process.cwd(),
      persist: true,
      qualityId: 'runner-test',
    })
    const collected = await runner.collect({
      modules: [{ file: 'inline.eval.ts', exports: { evaluation } }],
    })
    const run = await runner.run({ evaluations: collected.evaluations })

    const promoted = await runner.promote({
      evaluations: collected.evaluations,
      experimentId: run.experiments[0]!.experimentId,
    })

    expect(promoted.exitCode).toBe(0)
    const record = JSON.parse(readFileSync(promoted.baseline!.path, 'utf8')) as { evaluationId: string }
    expect(record.evaluationId).toBe('runner.promote.observability')

    await observe.flush()
    const evalRun = runStarts(transport.records).find((entry) => entry.rootPrimitive === 'eval.run')
    const promotion = artifactRecords(transport.records).find((entry) => entry.kind === 'baseline.promotion')
    expect(promotion).toMatchObject({
      kind: 'baseline.promotion',
      preview: {
        kind: 'baseline.promotion',
        evaluationId: 'runner.promote.observability',
        experimentId: run.experiments[0]!.experimentId,
        baselineId: promoted.baseline!.baselineId,
      },
      attributes: expect.objectContaining({
        evaluationId: 'runner.promote.observability',
        experimentId: run.experiments[0]!.experimentId,
        variant: 'default',
        configFingerprint: run.experiments[0]!.configFingerprint,
      }),
    })
    expect(edgeRecords(transport.records)).toContainEqual(
      expect.objectContaining({
        edgeType: 'produced',
        from: { kind: 'artifact', id: promotion!.artifactId },
        to: { kind: 'run', id: evalRun!.runId },
      }),
    )
  })

  it('emits a diff-mode comparison.report artifact from core experiment diffs', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const runner = createQualityRunner({ qualityId: 'runner-test' })
    const base = {
      schemaVersion: 2,
      evaluationId: 'runner.compare.observability',
      qualityId: 'test',
      startedAt: '2026-07-08T00:00:00.000Z',
      endedAt: '2026-07-08T00:00:01.000Z',
      configFingerprint: 'same',
      taskFingerprint: 'task',
      filteredRun: false,
      replay: { mode: 'live' },
      variants: [{ name: 'default', overrideKeys: [] }],
      aggregates: { perVariant: {} },
      gates: { passed: true, informational: false, results: [] },
      passed: true,
    } as const

    const diff = await runner.compare({
      a: {
        ...base,
        experimentId: '01KTRUNNERA',
        observability: {
          runId: 'run_aaaaaaaaaaaaaaaaaaaaaaaa',
          traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        cells: [runnerCompareCell('case-1', 1, true)],
      },
      b: {
        ...base,
        experimentId: '01KTRUNNERB',
        observability: {
          runId: 'run_bbbbbbbbbbbbbbbbbbbbbbbb',
          traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        gates: { passed: false, informational: false, results: [] },
        passed: false,
        cells: [runnerCompareCell('case-1', 0.25, false)],
      },
    })

    expect(diff.scores.find((score) => score.name === 'quality')?.delta).toBe(-0.75)
    await observe.flush()
    const report = artifactRecords(transport.records).find((entry) => entry.kind === 'comparison.report')
    expect(report).toMatchObject({
      runId: 'run_bbbbbbbbbbbbbbbbbbbbbbbb',
      kind: 'comparison.report',
      preview: {
        kind: 'comparison.report',
        mode: 'diff',
        a: { experimentId: '01KTRUNNERA' },
        b: { experimentId: '01KTRUNNERB' },
        comparable: true,
      },
      attributes: expect.objectContaining({
        mode: 'diff',
        experimentA: '01KTRUNNERA',
        experimentB: '01KTRUNNERB',
      }),
    })
    expect(edgeRecords(transport.records)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          edgeType: 'comparison.baseline',
          from: { kind: 'artifact', id: report!.artifactId },
          to: { kind: 'run', id: 'run_aaaaaaaaaaaaaaaaaaaaaaaa' },
        }),
        expect.objectContaining({
          edgeType: 'comparison.candidate',
          from: { kind: 'artifact', id: report!.artifactId },
          to: { kind: 'run', id: 'run_bbbbbbbbbbbbbbbbbbbbbbbb' },
        }),
      ]),
    )
  })
})

function runnerCompareCell(caseId: string, score: number, passed: boolean) {
  return {
    caseId,
    variantName: 'default',
    trial: 0,
    input: {},
    expected: undefined,
    output: {},
    scores: [{ name: 'quality', score }],
    assertions: { passed, outcomes: [] },
    traceIds: [],
    durationMs: 1,
    status: passed ? 'passed' : 'failed',
  } as const
}
