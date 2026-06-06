/**
 * Persist CLI eval runner output into the local Quality workbench store.
 *
 * This file is Node-only and intentionally lives in devtools rather than
 * `@crux/core/quality`, because the eval runner already has completed reports.
 *
 * @module
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type {
  EvalReport,
  FlowEvalReport,
  RagEvalReport,
  RagEvalCaseResult,
  MetricResult,
} from '@crux/core/testing'
import type {
  ExperimentCaseResult,
  ExperimentRecord,
  JsonRecord,
  JsonValue,
  QualityAssertionResult,
  QualityScore,
} from '@crux/core/quality'
import type { QualityConfig } from '@crux/core/quality/types'
import type { FlowRunResult, RagRunResult, RunResult } from './eval-orchestrator'

export interface PersistQualityEvalOptions {
  readonly quality?: QualityConfig
  readonly configDir: string
  readonly evalResults: readonly RunResult[]
  readonly flowResults: readonly FlowRunResult[]
  readonly ragResults: readonly RagRunResult[]
  readonly definitionFingerprints?: Readonly<Record<string, string>>
  readonly now?: () => Date
}

export async function persistQualityEvalResults(
  options: PersistQualityEvalOptions,
): Promise<readonly ExperimentRecord[]> {
  if (!options.quality) return Object.freeze([])

  const timestamp = options.now?.() ?? new Date()
  const dir = resolveQualityDir(options.configDir, options.quality.dir)
  const records = [
    ...options.evalResults.map((result) =>
      promptEvalToExperiment(options.quality!.id, result, timestamp, options.definitionFingerprints),
    ),
    ...options.flowResults.map((result) =>
      flowEvalToExperiment(options.quality!.id, result, timestamp, options.definitionFingerprints),
    ),
    ...options.ragResults.map((result) =>
      ragEvalToExperiment(options.quality!.id, result, timestamp, options.definitionFingerprints),
    ),
  ]

  await mkdir(join(dir, 'experiments'), { recursive: true })
  for (const record of records) {
    await writeFile(join(dir, 'experiments', `${safeFileName(record.id)}.json`), `${JSON.stringify(record, null, 2)}\n`)
  }

  return Object.freeze(records)
}

function resolveQualityDir(configDir: string, dir = '.crux/quality'): string {
  return isAbsolute(dir) ? dir : join(configDir, dir)
}

function assertionFromResult(passed: boolean, error?: string): QualityAssertionResult {
  if (passed) {
    return Object.freeze({ passed: true })
  }
  const message = error ?? 'Assertion failed.'
  return Object.freeze({
    passed: false,
    error: message,
    failures: Object.freeze([
      {
        source: 'expect' as const,
        message,
      },
    ]),
  })
}

function promptEvalToExperiment(
  qualityId: string,
  result: RunResult,
  timestamp: Date,
  definitionFingerprints?: Readonly<Record<string, string>>,
): ExperimentRecord {
  if (!result.report) {
    return errorExperiment({
      qualityId,
      id: `eval-${slugify(result.name)}-${timestamp.getTime()}`,
      suiteId: result.name,
      targetId: result.name,
      startedAt: timestamp,
      durationMs: result.durationMs,
      caseCount: result.caseCount,
      error: result.error ?? 'Prompt eval failed before producing a report.',
    })
  }

  const cases = result.report.results.map((item) =>
    freezeCase({
      caseId: slugify(item.caseName),
      caseName: item.caseName,
      variantId: item.modelId,
      status: evalCaseStatus(item.passed, item.error, item.failureCategory),
      input: toJsonValue(item.input ?? { caseName: item.caseName }),
      ...(item.output !== undefined ? { output: toJsonValue(item.output) } : {}),
      ...(item.usage ? { usage: toJsonValue(item.usage) } : {}),
      ...(typeof item.cost === 'number' ? { cost: item.cost } : {}),
      ...(item.traceId ? { traceId: item.traceId } : {}),
      scores: Object.freeze(scoresFromPromptEval(item.scores)),
      assertion: assertionFromResult(item.passed, item.error),
      durationMs: item.durationMs,
      ...(item.error ? { error: item.error } : {}),
    }),
  )

  return experimentFromCases({
    qualityId,
    id: `eval-${slugify(result.name)}-${timestamp.getTime()}`,
    suiteId: result.name,
    source: { kind: 'code' },
    caseCount: result.caseCount,
    targetIds: targetIdsFromPromptReport(result.name, result.report, definitionFingerprints),
    startedAt: new Date(timestamp.getTime() - result.durationMs),
    endedAt: timestamp,
    cases,
  })
}

function flowEvalToExperiment(
  qualityId: string,
  result: FlowRunResult,
  timestamp: Date,
  definitionFingerprints?: Readonly<Record<string, string>>,
): ExperimentRecord {
  if (!result.report) {
    return errorExperiment({
      qualityId,
      id: `flow-${slugify(result.name)}-${timestamp.getTime()}`,
      suiteId: result.name,
      targetId: result.name,
      startedAt: timestamp,
      durationMs: result.durationMs,
      caseCount: result.caseCount,
      error: result.error ?? 'Flow eval failed before producing a report.',
    })
  }

  const cases = result.report.results.map((item) =>
    freezeCase({
      caseId: slugify(item.caseName),
      caseName: item.caseName,
      variantId: item.configName,
      status: item.passed ? 'passed' : item.trace.error ? 'error' : 'failed',
      input: toJsonValue({ caseName: item.caseName }),
      output: toJsonValue({
        trace: {
          configName: item.trace.configName,
          stepResults: item.trace.stepResults,
          durationMs: item.trace.durationMs,
          totalUsage: item.trace.totalUsage,
          totalCost: item.trace.totalCost,
          ...(item.trace.error ? { error: item.trace.error } : {}),
        },
      }),
      usage: toJsonValue(item.trace.totalUsage),
      cost: item.trace.totalCost,
      scores: Object.freeze([
        {
          kind: 'numeric' as const,
          name: 'flow.steps',
          value: Object.keys(item.trace.stepResults).length,
          passed: item.passed,
        },
      ]),
      assertion: assertionFromResult(item.passed, item.error),
      durationMs: item.durationMs,
      ...(item.error ? { error: item.error } : {}),
    }),
  )

  return experimentFromCases({
    qualityId,
    id: `flow-${slugify(result.name)}-${timestamp.getTime()}`,
    suiteId: result.name,
    source: { kind: 'code' },
    caseCount: result.caseCount,
    targetIds: targetIdsFromFlowReport(result.name, result.report, definitionFingerprints),
    startedAt: new Date(timestamp.getTime() - result.durationMs),
    endedAt: timestamp,
    cases,
  })
}

function ragEvalToExperiment(
  qualityId: string,
  result: RagRunResult,
  timestamp: Date,
  definitionFingerprints?: Readonly<Record<string, string>>,
): ExperimentRecord {
  if (!result.report) {
    return errorExperiment({
      qualityId,
      id: `rag-${slugify(result.name)}-${timestamp.getTime()}`,
      suiteId: result.name,
      targetId: result.name,
      startedAt: timestamp,
      durationMs: result.durationMs,
      caseCount: result.caseCount,
      error: result.error ?? 'RAG eval failed before producing a report.',
    })
  }

  const cases = result.report.cases.map((item) =>
    freezeCase({
      caseId: item.caseId,
      caseName: item.caseName,
      variantId: ragVariantId(item),
      status: item.status === 'error' ? 'error' : item.passed ? 'passed' : 'failed',
      input: toJsonValue(item.input),
      output: toJsonValue(ragOutputSnapshot(item)),
      ...(item.usage ? { usage: toJsonValue(item.usage) } : {}),
      ...(typeof item.cost === 'number' ? { cost: item.cost } : {}),
      scores: Object.freeze(scoresFromRagCase(item)),
      assertion: item.passed
        ? { passed: true }
        : assertionFromResult(false, item.failureTypes.join(', ') || item.error || 'RAG eval failed.'),
      durationMs: item.durationMs,
      ...(item.error ? { error: item.error } : {}),
    }),
  )

  return experimentFromCases({
    qualityId,
    id: `rag-${slugify(result.name)}-${timestamp.getTime()}`,
    suiteId: result.report.datasetId ?? result.name,
    source: { kind: 'code' },
    caseCount: result.caseCount,
    targetIds: targetIdsFromRagReport(result.name, result.report, definitionFingerprints),
    startedAt: new Date(Date.parse(result.report.startedAt)),
    endedAt: new Date(Date.parse(result.report.endedAt)),
    cases,
  })
}

function errorExperiment(input: {
  readonly qualityId: string
  readonly id: string
  readonly suiteId: string
  readonly targetId: string
  readonly startedAt: Date
  readonly durationMs: number
  readonly caseCount: number
  readonly error: string
}): ExperimentRecord {
  return experimentFromCases({
    qualityId: input.qualityId,
    id: input.id,
    suiteId: input.suiteId,
    source: { kind: 'code' },
    caseCount: input.caseCount,
    targetIds: Object.freeze([{ id: 'runner', targetId: input.targetId }]),
    startedAt: new Date(input.startedAt.getTime() - input.durationMs),
    endedAt: input.startedAt,
    cases: Object.freeze([
      freezeCase({
        caseId: 'runner-error',
        caseName: 'Runner error',
        variantId: 'runner',
        status: 'error',
        input: toJsonValue({}),
        scores: Object.freeze([]),
        durationMs: input.durationMs,
        error: input.error,
      }),
    ]),
  })
}

function experimentFromCases(input: {
  readonly qualityId: string
  readonly id: string
  readonly suiteId: string
  readonly source: ExperimentRecord['suite']['source']
  readonly caseCount: number
  readonly targetIds: readonly {
    readonly id: string
    readonly targetId: string
    readonly definitionFingerprint?: string
  }[]
  readonly startedAt: Date
  readonly endedAt: Date
  readonly cases: readonly ExperimentCaseResult[]
}): ExperimentRecord {
  const summary = summarizeCases(input.cases)
  return Object.freeze({
    _tag: 'Experiment' as const,
    id: input.id,
    qualityId: input.qualityId,
    suite: Object.freeze({
      id: input.suiteId,
      source: input.source,
      caseCount: input.caseCount,
      snapshot: Object.freeze([]),
    }),
    variants: Object.freeze(
      input.targetIds.map((variant) =>
        Object.freeze({
          id: variant.id,
          targetId: variant.targetId,
          ...(variant.definitionFingerprint ? { definitionFingerprint: variant.definitionFingerprint } : {}),
        }),
      ),
    ),
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    status: summary.errored > 0 ? 'error' : summary.failed > 0 ? 'failed' : 'passed',
    summary,
    cases: Object.freeze([...input.cases]),
  })
}

function summarizeCases(cases: readonly ExperimentCaseResult[]): ExperimentRecord['summary'] {
  const byVariant: Record<string, { total: number; passed: number; failed: number; errored: number }> = {}
  let passed = 0
  let failed = 0
  let errored = 0

  for (const item of cases) {
    const current = byVariant[item.variantId] ?? { total: 0, passed: 0, failed: 0, errored: 0 }
    current.total++
    if (item.status === 'passed') {
      current.passed++
      passed++
    } else if (item.status === 'failed') {
      current.failed++
      failed++
    } else {
      current.errored++
      errored++
    }
    byVariant[item.variantId] = current
  }

  return Object.freeze({
    total: cases.length,
    passed,
    failed,
    errored,
    byVariant,
  })
}

function freezeCase(input: ExperimentCaseResult): ExperimentCaseResult {
  return Object.freeze(input)
}

function targetIdsFromPromptReport(
  targetId: string,
  report: EvalReport,
  definitionFingerprints?: Readonly<Record<string, string>>,
): readonly { readonly id: string; readonly targetId: string; readonly definitionFingerprint?: string }[] {
  return Object.freeze(
    Object.keys(report.summary.byModel).map((modelId) =>
      Object.freeze({
        id: modelId,
        targetId,
        ...definitionFingerprintForTarget(targetId, definitionFingerprints),
      }),
    ),
  )
}

function targetIdsFromFlowReport(
  targetId: string,
  report: FlowEvalReport,
  definitionFingerprints?: Readonly<Record<string, string>>,
): readonly { readonly id: string; readonly targetId: string; readonly definitionFingerprint?: string }[] {
  return Object.freeze(
    Object.keys(report.summary.byConfig).map((configName) =>
      Object.freeze({
        id: configName,
        targetId,
        ...definitionFingerprintForTarget(targetId, definitionFingerprints),
      }),
    ),
  )
}

function targetIdsFromRagReport(
  targetId: string,
  report: RagEvalReport,
  definitionFingerprints?: Readonly<Record<string, string>>,
): readonly { readonly id: string; readonly targetId: string; readonly definitionFingerprint?: string }[] {
  const ids = new Set(report.cases.map(ragVariantId))
  return Object.freeze(
    [...ids].map((id) =>
      Object.freeze({
        id,
        targetId,
        ...definitionFingerprintForTarget(targetId, definitionFingerprints),
      }),
    ),
  )
}

function definitionFingerprintForTarget(
  targetId: string,
  definitionFingerprints: Readonly<Record<string, string>> | undefined,
): { readonly definitionFingerprint?: string } {
  if (!definitionFingerprints) return {}
  for (const candidate of [
    targetId,
    `prompt:${targetId}`,
    `flow:${targetId}`,
    `eval.prompt:${targetId}`,
    `eval.flow:${targetId}`,
    `eval.rag:${targetId}`,
    `rag.pipeline:${targetId}`,
    `agent:${targetId}`,
    `tool:${targetId}`,
  ]) {
    const fingerprint = definitionFingerprints[candidate]
    if (fingerprint) return { definitionFingerprint: fingerprint }
  }
  return {}
}

function ragVariantId(item: RagEvalCaseResult): string {
  if (item.configLabel) return slugify(item.configLabel)
  return item.configRole ?? 'single'
}

function evalCaseStatus(
  passed: boolean,
  error: string | undefined,
  failureCategory: string | undefined,
): ExperimentCaseResult['status'] {
  if (passed) return 'passed'
  if (failureCategory === 'api_error' || failureCategory === 'timeout') return 'error'
  return error ? 'failed' : 'failed'
}

function scoresFromPromptEval(
  scores: Record<string, { score: number; reasoning?: string }> | undefined,
): readonly QualityScore[] {
  if (!scores) return Object.freeze([])
  return Object.freeze(
    Object.entries(scores).map(([name, score]) =>
      Object.freeze({
        kind: 'numeric' as const,
        name,
        value: score.score,
        ...(score.reasoning ? { reasoning: score.reasoning } : {}),
      }),
    ),
  )
}

function scoresFromRagCase(item: RagEvalCaseResult): readonly QualityScore[] {
  return Object.freeze([
    {
      kind: 'boolean' as const,
      name: 'rag.passed',
      passed: item.passed,
      ...(item.primaryFailureType ? { reasoning: item.primaryFailureType } : {}),
    },
    {
      kind: 'numeric' as const,
      name: 'rag.hit_count',
      value: item.retrieval.hitCount,
      passed: item.passed,
    },
    {
      kind: 'numeric' as const,
      name: 'rag.citation_valid',
      value: metricPassed(item.citations.metrics.sourceExists) && metricPassed(item.citations.metrics.chunkExists) ? 1 : 0,
      passed: item.citations.status !== 'failed',
    },
  ])
}

function metricPassed(metric: MetricResult | undefined): boolean {
  return metric?.status !== 'failed'
}

function ragOutputSnapshot(item: RagEvalCaseResult): JsonRecord {
  return {
    answer: toJsonValue({
      status: item.answer.status,
      text: item.answer.text,
      output: item.answer.output,
      metrics: item.answer.metrics,
    }),
    retrieval: toJsonValue(item.retrieval),
    evidence: toJsonValue(item.evidence),
    citations: toJsonValue(item.citations),
    trace: toJsonValue(item.trace),
    failureTypes: toJsonValue(item.failureTypes),
  }
}

function safeFileName(value: string): string {
  return slugify(value).slice(0, 180) || 'record'
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180)
}

function toJsonValue(value: unknown): JsonValue {
  const normalized = normalizeJson(value, new WeakSet<object>())
  return normalized === undefined ? null : normalized
}

function normalizeJson(value: unknown, seen: WeakSet<object>): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (Array.isArray(value)) return Object.freeze(value.map((item) => toJsonValue(item)))
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const output: Record<string, JsonValue> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeJson(nested, seen)
      if (normalized !== undefined) output[key] = normalized
    }
    seen.delete(value)
    return Object.freeze(output)
  }
  return String(value)
}
