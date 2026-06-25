/**
 * Static Index compiler response contracts.
 *
 * Responses are kept separate from requests so host transports can import only
 * the side of the protocol they validate. Method literals still use the current
 * cross-language wire names until the protocol rename phase.
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
    method: z.literal('nativeStaticPrepare'),
    plan: StaticIndexPreparedPlanSchema,
  })
  .strict()

/** Response from Static Index analyze. */
export const StaticIndexAnalyzeResponseSchema = z
  .object({
    ...staticIndexResponseBase,
    method: z.literal('nativeStaticAnalyze'),
    facts: unknownArraySchema,
    extensionEvidenceJobs: unknownArraySchema,
  })
  .strict()

/** Response from Static Index finalization. */
export const StaticIndexFinalizeResponseSchema = z
  .object({
    protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
    method: z.literal('nativeStaticFinalize'),
    events: unknownArraySchema,
    telemetry: StaticIndexTelemetrySchema,
  })
  .strict()

/** Response from streamed Static Index compilation. */
export const StaticIndexCompileResponseSchema = z
  .object({
    protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
    method: z.literal('nativeStaticCompile'),
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
