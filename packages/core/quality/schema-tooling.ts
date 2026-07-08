/**
 * Schemas for Quality CLI and report JSON contracts.
 *
 * @internal Re-exported from `quality/schemas`.
 * @module
 */

import { z } from 'zod'
import type { GateResult } from './gates'
import type { ExperimentDiff, JudgeReport, RunSummary } from './schema-types'

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

/** Schema for `crux quality run --json`. */
export const runSummarySchema: z.ZodType<RunSummary> = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string(),
    passed: z.boolean(),
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    evaluations: z.array(
      z
        .object({
          id: z.string(),
          experimentId: z.string().optional(),
          recordPath: z.string().optional(),
          passed: z.boolean(),
          gates: z.array(gateResultSchema),
          cells: z.object({
            total: z.number(),
            passed: z.number(),
            failed: z.number(),
            errored: z.number(),
            skipped: z.number(),
          }),
          failures: z.array(
            z.object({
              caseId: z.string(),
              variant: z.string(),
              trial: z.number(),
              phase: z.string(),
              summary: z.string(),
              evidence: z.object({ recordPath: z.string().optional(), cellEvidenceCommand: z.string().optional() }),
            }),
          ),
          cost: z.object({ totalUsd: z.number().optional() }).optional(),
          durationMs: z.number().optional(),
        })
        .passthrough(),
    ),
    summary: z.string().optional(),
  })
  .passthrough()

/** Schema for `crux quality diff --json`. */
export const experimentDiffSchema: z.ZodType<ExperimentDiff> = z
  .object({
    schemaVersion: z.literal(1),
    a: z.object({ experimentId: z.string() }),
    b: z.object({ experimentId: z.string() }),
    comparable: z.boolean(),
    fingerprintDrift: z.array(z.string()),
    scores: z.array(
      z.object({
        name: z.string(),
        aMean: z.number(),
        bMean: z.number(),
        delta: z.number(),
        sem: z.number(),
        significant: z.boolean(),
      }),
    ),
    cases: z.array(
      z.object({
        caseId: z.string(),
        variant: z.string(),
        aPassed: z.boolean(),
        bPassed: z.boolean(),
        scoreDeltas: z.record(z.string(), z.number()),
      }),
    ),
    onlyInA: z.array(z.string()),
    onlyInB: z.array(z.string()),
    gatesVerdict: z.object({ aPassed: z.boolean(), bPassed: z.boolean() }),
  })
  .passthrough()

/** Schema for `crux quality judge-report --json`. */
export const judgeReportSchema: z.ZodType<JudgeReport> = z
  .object({
    schemaVersion: z.literal(1),
    evaluationId: z.string(),
    scorers: z.array(
      z
        .object({
          name: z.string(),
          threshold: z.number(),
          labeled: z.number(),
          confusion: z.object({ tp: z.number(), fp: z.number(), fn: z.number(), tn: z.number() }),
          agreement: z.number(),
          precision: z.number().nullable(),
          recall: z.number().nullable(),
          kappa: z.number().nullable(),
          disagreements: z.array(
            z.object({
              experimentId: z.string(),
              caseId: z.string(),
              variant: z.string(),
              trial: z.number(),
              human: z.enum(['pass', 'fail']),
              judgeScore: z.number().nullable(),
              rationale: z.string().optional(),
            }),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough()
