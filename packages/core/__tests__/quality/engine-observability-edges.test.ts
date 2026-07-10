import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loopRuntimeAdapter } from '../../src/adapter'
import {
  fakeLoopRuntime,
  type FakeLoopRuntimeConfig,
} from '../../src/adapter/testing'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
  type CruxEdgeRecord,
  type CruxRunEndRecord,
  type CruxRunStartRecord,
} from '../../src/observability'
import { prompt } from '../../src/prompt/prompt'
import { evaluate } from '../../src/quality'
import type { RunOverrides } from '../../src/quality/experiment'
import { runEvaluationWithRunner as run } from './runner-harness'

const tempDirs: string[] = []

afterEach(async () => {
  resetObservabilityRuntime()
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

function runStarts(records: readonly unknown[]): CruxRunStartRecord[] {
  return records.filter((record): record is CruxRunStartRecord => {
    return (
      typeof record === 'object' &&
      record !== null &&
      (record as { type?: unknown }).type === 'run:start'
    )
  })
}

function runEnds(records: readonly unknown[]): CruxRunEndRecord[] {
  return records.filter((record): record is CruxRunEndRecord => {
    return (
      typeof record === 'object' &&
      record !== null &&
      (record as { type?: unknown }).type === 'run:end'
    )
  })
}

function edges(
  records: readonly unknown[],
  edgeType: CruxEdgeRecord['edgeType'],
): CruxEdgeRecord[] {
  return records.filter((record): record is CruxEdgeRecord => {
    return (
      typeof record === 'object' &&
      record !== null &&
      (record as { type?: unknown }).type === 'edge' &&
      (record as { edgeType?: unknown }).edgeType === edgeType
    )
  })
}

function executorSetup(config: FakeLoopRuntimeConfig) {
  const fake = fakeLoopRuntime(config)
  const executor = loopRuntimeAdapter(fake.runtime)
  return { generate: executor.generate.bind(executor) as never }
}

const answerPrompt = prompt({
  id: 'edges.replay.answer',
  input: z.object({ q: z.string() }),
  prompt: ({ input }) => input.q,
})

describe('Quality runner observability graph edges', () => {
  it('wraps an evaluation in an eval.run trace and links each eval.case run to it', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const evaluation = evaluate('edges.eval-case', {
      task: async (input: { q: string }) => input.q.toUpperCase(),
      data: [
        { name: 'one', input: { q: 'a' } },
        { name: 'two', input: { q: 'b' } },
      ],
    })

    const experiment = await run(evaluation)
    await observe.flush()

    const starts = runStarts(transport.records)
    const evalRun = starts.find((record) => record.rootPrimitive === 'eval.run')
    const caseRuns = starts.filter(
      (record) => record.rootPrimitive === 'eval.case',
    )
    const caseEdges = edges(transport.records, 'eval.case_of')

    expect(evalRun).toMatchObject({
      name: 'quality:edges.eval-case',
      attributes: expect.objectContaining({
        evaluationId: 'edges.eval-case',
        caseCount: 2,
        variantCount: 1,
      }),
    })
    expect(caseRuns.map((record) => record.runId).sort()).toEqual(
      [...experiment.cells.map((cell) => cell.traceIds[0]!)].sort(),
    )
    expect(new Set(caseRuns.map((record) => record.traceId))).toEqual(
      new Set([evalRun!.traceId]),
    )
    expect(caseEdges).toHaveLength(2)
    expect(caseEdges.map((edge) => edge.to)).toEqual([
      { kind: 'run', id: evalRun!.runId },
      { kind: 'run', id: evalRun!.runId },
    ])
    expect(caseEdges.map((edge) => edge.from.id).sort()).toEqual(
      caseRuns.map((record) => record.runId).sort(),
    )
  })

  it('ends the eval.run with error when a post-cell persistence step fails', async () => {
    const dir = await mkdtemp(
      join(tmpdir(), 'crux-quality-edges-persist-error-'),
    )
    tempDirs.push(dir)
    await writeFile(join(dir, 'experiments'), 'not a directory', 'utf8')
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const evaluation = evaluate('edges.persist-error', {
      task: async (input: { q: string }) => input.q,
      data: [{ input: { q: 'a' } }],
    })

    await expect(
      run(evaluation, undefined, { dir, persist: true }),
    ).rejects.toThrow()
    await observe.flush()

    const evalRun = runStarts(transport.records).find(
      (record) => record.rootPrimitive === 'eval.run',
    )
    expect(evalRun).toBeDefined()
    expect(
      runEnds(transport.records).filter(
        (record) => record.runId === evalRun!.runId,
      ),
    ).toEqual([expect.objectContaining({ status: 'error' })])
  })

  it('emits comparison report artifacts with candidate and promoted-baseline run edges', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-edges-'))
    tempDirs.push(dir)
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)

    const makeEvaluation = (hardScore: number) =>
      evaluate('edges.comparison', {
        task: (input: { name: string }) => ({
          score: input.name === 'hard' ? hardScore : 1,
        }),
        data: [
          { name: 'easy', input: { name: 'easy' } },
          { name: 'hard', input: { name: 'hard' } },
        ],
        scorers: [
          ({ output }: { output: unknown }) => ({
            name: 'quality',
            score: (output as { score: number }).score,
          }),
        ],
        gates: { scores: { quality: { minDeltaVsBaseline: -0.02 } } },
      })

    const baseline = await run(makeEvaluation(1), undefined, { dir })
    await baseline.promote()
    await observe.flush()
    const baselineEvalRun = runStarts(transport.records)
      .filter((record) => record.rootPrimitive === 'eval.run')
      .at(-1)!

    const candidate = await run(makeEvaluation(0.2), undefined, { dir })
    await observe.flush()
    const candidateEvalRun = runStarts(transport.records)
      .filter((record) => record.rootPrimitive === 'eval.run')
      .at(-1)!
    const report = transport.records.find(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        (record as { type?: unknown }).type === 'artifact' &&
        (record as { kind?: unknown }).kind === 'comparison.report',
    ) as { artifactId?: unknown; preview?: unknown } | undefined

    expect(candidate.comparison).toMatchObject({
      kind: 'promoted',
      baseline: baseline.experimentId,
    })
    expect(report?.preview).toMatchObject({
      kind: 'comparison.report',
      comparisonKind: 'promoted',
      baseline: baseline.experimentId,
    })
    expect(edges(transport.records, 'comparison.candidate')).toContainEqual(
      expect.objectContaining({
        from: { kind: 'artifact', id: report!.artifactId },
        to: { kind: 'run', id: candidateEvalRun.runId },
      }),
    )
    expect(edges(transport.records, 'comparison.baseline')).toContainEqual(
      expect.objectContaining({
        from: { kind: 'artifact', id: report!.artifactId },
        to: { kind: 'run', id: baselineEvalRun.runId },
      }),
    )
  })

  it('links a replayed cassette case run to the originally recorded case run once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crux-quality-replay-edges-'))
    tempDirs.push(dir)
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const evaluation = evaluate('edges.replay', {
      task: answerPrompt,
      data: [{ input: { q: 'refunds' } }],
      replay: 'record-new',
    })

    const recordRun = await run(evaluation, undefined, {
      dir,
      setup: {
        ...executorSetup({ loops: [[{ text: 'recorded answer' }]] }),
        model: 'fake:m1',
      },
    })
    await observe.flush()

    const replayRun = await run(
      evaluation,
      { replayMode: 'replay-strict' } satisfies RunOverrides<string>,
      {
        dir,
        setup: {
          ...executorSetup({ loops: [[{ text: 'should not run' }]] }),
          model: 'fake:m1',
        },
      },
    )
    await observe.flush()

    expect(edges(transport.records, 'replay.of')).toEqual([
      expect.objectContaining({
        from: { kind: 'run', id: replayRun.cells[0]!.traceIds[0] },
        to: { kind: 'run', id: recordRun.cells[0]!.traceIds[0] },
      }),
    ])
  })
})
