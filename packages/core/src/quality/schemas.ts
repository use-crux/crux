/** Machine-readable schemas for Quality artifacts. @module */

import { z } from 'zod'
import type {
  CellAssertionExpression,
  CellAssertionOutcome,
  CellScore,
  Comparison,
  Experiment,
  ExperimentCell,
  VariantAggregate,
} from './experiment'
import type { GateResult } from './gates'
import type { QualitySourceFrame } from './source-frame'
import type { FailureArtifact } from './failure-artifact'
import type { ExperimentRecord } from './schema-types'
import { experimentDiffSchema, judgeReportSchema, runSummarySchema } from './schema-tooling'
import { evaluationManifestSchema } from './schema-manifest'

const jsonValueSchema: z.ZodType<unknown> = z.unknown()
const stringArraySchema = z.array(z.string())
const optionalRecordSchema = z.record(z.string(), z.unknown()).optional()
const replayModeSchema = z.enum(['live', 'record-new', 'replay-strict', 'refresh'])

const assertionValueSchema = z
  .object({
    label: z.string(),
    value: jsonValueSchema,
    preview: z.string(),
    redacted: z.boolean(),
  })
  .passthrough()

const sourceFrameLineSchema = z.object({
  line: z.number(),
  text: z.string(),
  role: z.enum(['context', 'failed', 'passed', 'not-evaluated']),
})

const sourceFrameSchema: z.ZodType<QualitySourceFrame> = z.union([
  z.object({
    kind: z.literal('source-frame'),
    sourceRef: z.string(),
    authoredFile: z.string(),
    authoredLine: z.number(),
    authoredColumn: z.number().optional(),
    frameStartLine: z.number(),
    frameEndLine: z.number(),
    lines: z.array(sourceFrameLineSchema),
    contentHash: z.string(),
    capturedAt: z.string(),
    stale: z.boolean(),
    resolver: z.enum(['source-map', 'catalog', 'disk']),
  }),
  z.object({
    kind: z.literal('unavailable'),
    reason: z.enum(['no-source-ref', 'source-map-missing', 'source-file-missing', 'source-outside-project', 'unsupported-language']),
  }),
])

const assertionExpressionSchema: z.ZodType<CellAssertionExpression> = z
  .object({
    left: assertionValueSchema,
    operator: z.enum(['>=', '>', '<=', '<', '==', '!=', 'contains', 'matches', 'custom']),
    right: assertionValueSchema.optional(),
    result: z.boolean(),
    rendered: z.string(),
  })
  .passthrough()

const assertionOutcomeSchema: z.ZodType<CellAssertionOutcome> = z
  .object({
    id: z.string(),
    level: z.enum(['evaluation', 'case']),
    phase: z.enum(['expect', 'afterScores']),
    index: z.number(),
    status: z.enum(['passed', 'failed', 'not-evaluated', 'uncaptured']),
    matcher: z.string(),
    soft: z.boolean(),
    message: z.string().optional(),
    subjectExpr: z.string().optional(),
    actual: assertionValueSchema.optional(),
    expected: assertionValueSchema.optional(),
    expression: assertionExpressionSchema.optional(),
    sourceRef: z.string().optional(),
    assertionSiteId: z.string().optional(),
    spanIds: stringArraySchema.optional(),
    sourceFrame: sourceFrameSchema.optional(),
  })
  .passthrough()

const cellScoreSchema: z.ZodType<CellScore> = z
  .object({
    name: z.string(),
    score: z.number().min(0).max(1).nullable(),
    label: z.string().optional(),
    costClass: z.enum(['code', 'model']).optional(),
    metadata: optionalRecordSchema,
  })
  .passthrough()

const experimentCellSchema: z.ZodType<ExperimentCell<unknown, unknown>> = z
  .object({
    caseId: z.string(),
    caseName: z.string().optional(),
    variantName: z.string(),
    trial: z.number(),
    status: z.enum(['passed', 'failed', 'errored', 'skipped']),
    skipReason: z.string().optional(),
    input: jsonValueSchema,
    output: jsonValueSchema.optional(),
    expected: jsonValueSchema.optional(),
    scores: z.array(cellScoreSchema),
    assertions: z.object({
      ran: z.number(),
      notEvaluated: z.number(),
      outcomes: z.array(assertionOutcomeSchema),
    }),
    error: z
      .object({
        message: z.string(),
        phase: z.enum(['execute', 'expect', 'afterScores', 'score', 'replay', 'timeout']),
        missingCassetteKey: z.string().optional(),
        sourceRef: z.string().optional(),
        sourceFrame: sourceFrameSchema.optional(),
        diagnostics: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
    durationMs: z.number(),
    costUsd: z.number().optional(),
    usage: z
      .object({
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number(),
        inputTokenDetails: z
          .object({
            cacheReadTokens: z.number().optional(),
            cacheWriteTokens: z.number().optional(),
          })
          .passthrough(),
        outputTokenDetails: z
          .object({
            reasoningTokens: z.number().optional(),
          })
          .passthrough(),
      })
      .passthrough()
      .optional(),
    traceIds: stringArraySchema,
    capturedSignals: stringArraySchema,
    metadata: optionalRecordSchema,
  })
  .passthrough()

const scoreAggregateSchema = z.object({ mean: z.number(), sem: z.number(), n: z.number() })

const variantAggregateSchema: z.ZodType<VariantAggregate<string>> = z
  .object({
    cells: z.number(),
    passed: z.number(),
    failed: z.number(),
    errored: z.number(),
    skipped: z.number(),
    passRate: z.number(),
    scores: z.record(z.string(), scoreAggregateSchema),
    consistency: z.object({ passAtK: z.number(), passAllTrials: z.number() }).optional(),
    latency: z.object({ meanMs: z.number(), p95Ms: z.number() }),
    costUsd: z.number().optional(),
  })
  .passthrough()

const gateResultSchema: z.ZodType<GateResult> = z
  .object({
    gate: z.string(),
    variantName: z.string().optional(),
    threshold: z.union([z.number(), z.boolean()]),
    actual: z.union([z.number(), z.boolean()]),
    passed: z.boolean(),
    informational: z.boolean().optional(),
  })
  .passthrough()

const comparisonSchema: z.ZodType<Comparison<string>> = z
  .object({
    kind: z.enum(['variant', 'promoted']),
    baseline: z.string(),
    deltas: z.array(
      z.object({
        variantName: z.string(),
        scoreName: z.string(),
        meanDelta: z.number(),
        sem: z.number(),
        n: z.number(),
      }),
    ),
    unmatchedCases: z.object({ baselineOnly: stringArraySchema, candidateOnly: stringArraySchema }),
    demoted: z.object({ reason: z.string() }).optional(),
  })
  .passthrough()

export const failureArtifactSchema: z.ZodType<FailureArtifact> = z
  .object({
    caseId: z.string(),
    caseName: z.string().optional(),
    variant: z.string(),
    trial: z.number(),
    phase: z.enum(['expect', 'afterScores', 'score', 'task', 'timeout', 'gate']),
    input: jsonValueSchema,
    expected: jsonValueSchema.optional(),
    output: jsonValueSchema.optional(),
    scores: z.array(
      z.object({
        name: z.string(),
        score: z.number().min(0).max(1).nullable(),
        baselineScore: z.number().min(0).max(1).nullable().optional(),
        delta: z.number().optional(),
        rationale: z.string().optional(),
      }),
    ),
    failedOutcomes: z.array(assertionOutcomeSchema),
    sourceRef: z.string().optional(),
    covers: stringArraySchema,
    traceId: z.string().optional(),
    spanIds: stringArraySchema,
    cassetteId: z.string().optional(),
    cost: z.object({ usd: z.number().optional() }).optional(),
    durationMs: z.number().optional(),
    datasetProvenance: z.object({ path: z.string(), contentFingerprint: z.string() }).optional(),
    suggestedFixSurfaces: z.array(
      z.enum(['prompt', 'context', 'retriever', 'tool-schema', 'handoff', 'judge', 'flake', 'unknown']),
    ),
  })
  .passthrough()

export const experimentRecordSchema: z.ZodType<ExperimentRecord> = z
  .object({
    schemaVersion: z.literal(2),
    experimentId: z.string(),
    evaluationId: z.string(),
    qualityId: z.string(),
    experimentLabel: z.string().optional(),
    startedAt: z.string(),
    endedAt: z.string(),
    configFingerprint: z.string(),
    taskFingerprint: z.string(),
    observability: z.object({ runId: z.string(), traceId: z.string(), segmentId: z.string() }).optional(),
    filteredRun: z.boolean(),
    replay: z
      .object({
        mode: replayModeSchema,
        cassette: z.string().optional(),
        trialsCollapsed: z.literal(true).optional(),
        staleSince: z.string().optional(),
      })
      .passthrough(),
    baselineRef: z.object({ baselineId: z.string(), experimentId: z.string(), variantName: z.string().optional() }).optional(),
    variants: z.array(
      z
        .object({
          name: z.string(),
          overrideKeys: stringArraySchema,
          overrides: z.record(z.string(), z.unknown()).optional(),
        })
        .passthrough(),
    ),
    cells: z.array(experimentCellSchema),
    failures: z.array(failureArtifactSchema).optional(),
    aggregates: z.object({ perVariant: z.record(z.string(), variantAggregateSchema) }),
    comparison: comparisonSchema.optional(),
    gates: z.object({
      passed: z.boolean(),
      informational: z.boolean(),
      results: z.array(gateResultSchema),
    }),
    passed: z.boolean(),
  })
  .passthrough()

const schemaByName = {
  experiment: experimentRecordSchema,
  manifest: evaluationManifestSchema,
  failure: failureArtifactSchema,
  diff: experimentDiffSchema,
  runSummary: runSummarySchema,
  judgeReport: judgeReportSchema,
} as const

export function toJsonSchema(schema: keyof typeof schemaByName): Record<string, unknown> {
  const rendered = z.toJSONSchema(schemaByName[schema])
  return JSON.parse(JSON.stringify(rendered)) as Record<string, unknown>
}

export type { FailureArtifact }
export type { ExperimentDiff, ExperimentRecord, JudgeReport, RunSummary } from './schema-types'
export { evaluationManifestSchema }
export { experimentDiffSchema, judgeReportSchema, runSummarySchema }
