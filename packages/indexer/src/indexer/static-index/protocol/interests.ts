/**
 * Parser-interest fields shared by Static Index prepare and analyze plans.
 *
 * These fields intentionally mirror the syntax-record worker filters. The
 * Static Index compiler consumes compiler-owned manifest interests instead of
 * hardcoding first-party or extension call names.
 *
 * @module
 */

import { z } from 'zod'

/** Declared callback property retained for parser evidence slices. */
export const StaticIndexParserCallbackInterestSchema = z
  .object({
    property: z.string().min(1),
    maxDepth: z.number().int().nonnegative().optional(),
  })
  .strict()

/** Import-aware call filter carried from the static syntax plan. */
export const StaticIndexParserCallInterestSchema = z
  .object({
    name: z.string().min(1),
    importFrom: z.array(z.string().min(1)).optional(),
    configArg: z.number().int().nonnegative().optional(),
    properties: z.array(z.string().min(1)).optional(),
    callbacks: z.array(StaticIndexParserCallbackInterestSchema).optional(),
    source: z.string().min(1).optional(),
  })
  .strict()

/** Import-aware constructor filter carried from the static syntax plan. */
export const StaticIndexParserConstructorInterestSchema = StaticIndexParserCallInterestSchema

/** Parser filters that must stay identical across prepare and analyze. */
export const staticIndexParserInterestFields = {
  callNames: z.array(z.string().min(1)).optional(),
  callInterests: z.array(StaticIndexParserCallInterestSchema).optional(),
  constructorNames: z.array(z.string().min(1)).optional(),
  constructorInterests: z.array(StaticIndexParserConstructorInterestSchema).optional(),
  pruneNativeFactCallNames: z.array(z.string().min(1)).optional(),
} satisfies z.ZodRawShape

/** Parser callback interest. */
export type StaticIndexParserCallbackInterest = z.infer<typeof StaticIndexParserCallbackInterestSchema>

/** Parser call interest. */
export type StaticIndexParserCallInterest = z.infer<typeof StaticIndexParserCallInterestSchema>

/** Parser constructor interest. */
export type StaticIndexParserConstructorInterest = z.infer<typeof StaticIndexParserConstructorInterestSchema>
