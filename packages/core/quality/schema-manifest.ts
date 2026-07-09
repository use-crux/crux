/**
 * Schema for collected Quality evaluation manifests.
 *
 * @internal Re-exported from `quality/schemas`.
 * @module
 */

import { z } from 'zod'
import type { EvaluationManifest } from './manifest'
import type { Capability } from './target'
import type { EvaluationCoverageTargetId } from './internal/definition'

const stringArraySchema = z.array(z.string())
const coverageTargetIdSchema = z.custom<EvaluationCoverageTargetId>(
  (value) => typeof value === 'string' && value.includes(':'),
)
const capabilitySchema = z.custom<Capability>((value) => typeof value === 'string')

/** Schema for a collected evaluation manifest. */
export const evaluationManifestSchema: z.ZodType<EvaluationManifest> = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().optional(),
    explicitId: z.boolean(),
    file: z.string().optional(),
    exportName: z.string().optional(),
    source: z.enum(['file', 'prompt-tests']),
    description: z.string().optional(),
    tags: stringArraySchema,
    covers: z.array(coverageTargetIdSchema).optional(),
    task: z.object({
      kind: z.enum(['prompt', 'flow', 'agent', 'retriever', 'fn']),
      ref: z.string().optional(),
      capabilities: z.array(capabilitySchema),
    }),
    cases: z.array(
      z
        .object({
          caseId: z.string(),
          name: z.string().optional(),
          hasExpect: z.boolean(),
          hasAfterScores: z.boolean(),
          trials: z.number(),
          tags: stringArraySchema,
          skip: z.union([z.boolean(), z.string()]).optional(),
          only: z.boolean().optional(),
        })
        .passthrough(),
    ),
    datasets: z.array(z.object({ path: z.string(), caseCount: z.number().optional() }).passthrough()),
    hasEvaluationExpect: z.boolean(),
    hasEvaluationAfterScores: z.boolean(),
    scorers: z.array(z.object({ name: z.string(), costClass: z.enum(['code', 'model']) }).passthrough()),
    variants: z.array(z.object({ name: z.string(), overrideKeys: stringArraySchema }).passthrough()),
    baseline: z.string().optional(),
    trials: z.number(),
    gates: z.record(z.string(), z.unknown()).optional(),
    replay: z.object({ mode: z.string(), cassette: z.string().optional() }).optional(),
    flags: z.object({ only: z.boolean(), skip: z.boolean() }),
  })
  .passthrough()
