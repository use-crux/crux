import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RagEvalReport } from '@crux/core/testing'
import { persistQualityEvalResults } from './quality-persistence'
import type { FlowRunResult, RagRunResult, RunResult } from './eval-orchestrator'
import type { ExperimentRecord } from '@crux/core/quality'

describe('persistQualityEvalResults()', () => {
  it('writes prompt eval reports as quality experiments', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'crux-quality-runner-'))
    const now = new Date('2026-05-14T12:00:00.000Z')
    const result: RunResult = {
      name: 'support-agent',
      durationMs: 20,
      caseCount: 1,
      report: {
        results: [
          {
            caseName: 'answers refund question',
            modelId: 'gpt-5-mini',
            passed: true,
            durationMs: 20,
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
            cost: 0.001,
            traceId: 'trace-1',
            input: { question: 'Refund?' },
            output: { answer: 'Refunds take five days.' },
            scores: { helpfulness: { score: 0.9, reasoning: 'Clear' } },
          },
        ],
        summary: {
          total: 1,
          passed: 1,
          failed: 0,
          byModel: { 'gpt-5-mini': { total: 1, passed: 1, failed: 0 } },
        },
      },
    }

    const records = await persistQualityEvalResults({
      quality: { id: 'local', dir: '.crux/quality' },
      configDir,
      evalResults: [result],
      flowResults: [],
      ragResults: [],
      definitionFingerprints: { 'prompt:support-agent': 'fp-support-agent' },
      now: () => now,
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.cases[0]).toMatchObject({
      caseId: 'answers-refund-question',
      variantId: 'gpt-5-mini',
      status: 'passed',
      cost: 0.001,
      traceId: 'trace-1',
    })
    expect(records[0]?.variants[0]).toMatchObject({
      targetId: 'support-agent',
      definitionFingerprint: 'fp-support-agent',
    })

    const raw = await readFile(join(configDir, '.crux/quality/experiments/eval-support-agent-1778760000000.json'), 'utf8')
    const persisted = JSON.parse(raw) as ExperimentRecord
    expect(persisted.summary).toMatchObject({ total: 1, passed: 1, failed: 0, errored: 0 })
  })

  it('writes flow and RAG eval reports into the same experiment store', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'crux-quality-runner-'))
    const now = new Date('2026-05-14T12:00:00.000Z')
    const flowResult: FlowRunResult = {
      name: 'handoff-flow',
      durationMs: 40,
      caseCount: 1,
      configCount: 1,
      report: {
        name: 'handoff-flow',
        results: [
          {
            caseName: 'delegates task',
            configName: 'cheap-first',
            passed: false,
            durationMs: 40,
            error: 'wrong assignee',
            trace: {
              configName: 'cheap-first',
              stepResults: {},
              step: () => {
                throw new Error('not used')
              },
              durationMs: 40,
              totalUsage: { totalTokens: 15 },
              totalCost: 0.002,
            },
          },
        ],
        summary: {
          total: 1,
          passed: 0,
          failed: 1,
          byConfig: { 'cheap-first': { total: 1, passed: 0, failed: 1 } },
          totalSteps: 0,
          avgSteps: 0,
          totalTokens: 15,
          totalCost: 0.002,
        },
      },
    }
    const ragReport: RagEvalReport = {
      _tag: 'RagEvalReport',
      id: 'support-rag',
      datasetId: 'docs',
      startedAt: '2026-05-14T11:59:59.000Z',
      endedAt: '2026-05-14T12:00:00.000Z',
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        passRate: 0,
        byFailureType: {
          retrieval_miss: 1,
          low_precision: 0,
          invalid_citation: 0,
          unsupported_answer: 0,
          judge_failed: 0,
          timeout: 0,
          error: 0,
        },
        failureGroups: [{ type: 'retrieval_miss', count: 1, caseIds: ['sso'] }],
      },
      cases: [
        {
          caseId: 'sso',
          caseName: 'SSO docs',
          configRole: 'candidate',
          configLabel: 'hybrid pipeline',
          input: { question: 'How do I set up SSO?' },
          status: 'failed',
          passed: false,
          durationMs: 50,
          failureTypes: ['retrieval_miss'],
          primaryFailureType: 'retrieval_miss',
          evidence: [],
          retrieval: {
            metrics: {
              status: 'failed',
              hitRateAtK: {},
              recallAtK: {},
              precisionAtK: {},
              mrr: { status: 'failed', score: 0, reason: 'miss' },
              ndcg: { status: 'failed', score: 0, reason: 'miss' },
            },
            hitCount: 0,
          },
          answer: { status: 'not_applicable', metrics: {} },
          citations: { status: 'not_applicable', metrics: {}, citations: [] },
          trace: { available: false, reason: 'plain retriever' },
        },
      ],
      exportFailedCases: () => ({ id: 'failed', cases: [] }),
    }
    const ragResult: RagRunResult = {
      name: 'support-rag',
      report: ragReport,
      failedCases: { id: 'failed', cases: [] },
      durationMs: 50,
      caseCount: 1,
    }

    const records = await persistQualityEvalResults({
      quality: { id: 'local', dir: '.crux/quality' },
      configDir,
      evalResults: [],
      flowResults: [flowResult],
      ragResults: [ragResult],
      now: () => now,
    })

    expect(records.map((record) => record.id)).toEqual(['flow-handoff-flow-1778760000000', 'rag-support-rag-1778760000000'])
    expect(records[0]?.cases[0]).toMatchObject({ variantId: 'cheap-first', status: 'failed', cost: 0.002 })
    expect(records[1]?.cases[0]).toMatchObject({ variantId: 'hybrid-pipeline', status: 'failed' })
  })
})
