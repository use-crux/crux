/**
 * Static Index compiler response contracts.
 *
 * Responses are kept separate from requests so host transports can import only
 * the side of the protocol they validate. Method literals use the final
 * `staticIndex*` wire strings shared by every runtime mirror.
 *
 * @module
 */

import { z } from 'zod'
import { STATIC_INDEX_COMPILER_PROTOCOL_VERSION } from './identity'
import { StaticIndexPreparedPlanSchema } from './request'
import { StaticIndexTelemetrySchema } from './telemetry'

const unknownArraySchema = z.array(z.unknown())

const staticIndexResponseBase = {
  protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
  diagnostics: unknownArraySchema,
  telemetry: StaticIndexTelemetrySchema,
} as const

/** Response from Static Index prepare. */
export const StaticIndexPrepareResponseSchema = z
  .object({
    ...staticIndexResponseBase,
    method: z.literal('staticIndexPrepare'),
    plan: StaticIndexPreparedPlanSchema,
  })
  .strict()

/** Response from Static Index analyze. */
export const StaticIndexAnalyzeResponseSchema = z
  .object({
    ...staticIndexResponseBase,
    method: z.literal('staticIndexAnalyze'),
    facts: unknownArraySchema,
    extensionEvidenceJobs: unknownArraySchema,
  })
  .strict()

/** Response from Static Index finalization. */
export const StaticIndexFinalizeResponseSchema = z
  .object({
    protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
    method: z.literal('staticIndexFinalize'),
    events: unknownArraySchema,
    telemetry: StaticIndexTelemetrySchema,
  })
  .strict()

/** Response from streamed Static Index compilation. */
export const StaticIndexCompileResponseSchema = z
  .object({
    protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
    method: z.literal('staticIndexCompile'),
    events: unknownArraySchema,
    telemetry: StaticIndexTelemetrySchema,
  })
  .strict()

/** Static Index compiler response union. */
export const StaticIndexCompilerResponseSchema = z.discriminatedUnion('method', [
  StaticIndexPrepareResponseSchema,
  StaticIndexAnalyzeResponseSchema,
  StaticIndexFinalizeResponseSchema,
  StaticIndexCompileResponseSchema,
])

/** Static Index compiler response. */
export type StaticIndexCompilerResponse = z.infer<typeof StaticIndexCompilerResponseSchema>
