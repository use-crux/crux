/**
 * Static Index compiler telemetry contracts.
 *
 * Hosts use this data to explain Node fallback, native-only eligibility, file
 * counts, fact counts, and cache activity without understanding compiler
 * internals.
 *
 * @module
 */

import { z } from 'zod'

const nonNegativeNumber = z.number().finite().nonnegative()

/** Machine-readable telemetry emitted by each Static Index stage. */
export const StaticIndexTelemetrySchema = z
  .object({
    node: z
      .object({
        started: z.boolean(),
        reasons: z.array(z.string()),
      })
      .strict(),
    nativeOnly: z
      .object({
        eligible: z.boolean(),
        reasons: z.array(z.string()),
      })
      .strict(),
    timings: z.array(
      z
        .object({
          name: z.string().min(1),
          durationMs: nonNegativeNumber,
          count: nonNegativeNumber.optional(),
        })
        .strict(),
    ),
    files: z
      .object({
        selected: nonNegativeNumber,
        cacheHits: nonNegativeNumber,
        cacheMisses: nonNegativeNumber,
        analyzed: nonNegativeNumber,
        skipped: nonNegativeNumber,
      })
      .strict(),
    cache: z
      .object({
        readHits: nonNegativeNumber,
        readMisses: nonNegativeNumber,
        writes: nonNegativeNumber,
        writeErrors: nonNegativeNumber,
      })
      .strict(),
    facts: z
      .object({
        definitions: nonNegativeNumber,
        relations: nonNegativeNumber,
        sourceRefs: nonNegativeNumber,
        diagnostics: nonNegativeNumber,
        lintFindings: nonNegativeNumber,
        ruleDescriptors: nonNegativeNumber,
        sources: nonNegativeNumber,
        sourceGraph: nonNegativeNumber,
      })
      .strict(),
  })
  .strict()

/** Static Index stage telemetry. */
export type StaticIndexTelemetry = z.infer<typeof StaticIndexTelemetrySchema>
