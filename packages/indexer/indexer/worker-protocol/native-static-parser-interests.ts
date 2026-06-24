/**
 * Parser-interest fields shared by native static prepare and analyze plans.
 *
 * These fields intentionally mirror the syntax-record worker filters. The
 * native static compiler must consume the compiler-owned manifest interests
 * instead of hardcoding first-party or extension call names.
 */

import { z } from 'zod'

/** Declared callback property retained for parser evidence slices. */
export const NativeStaticParserCallbackInterestSchema = z
  .object({
    property: z.string().min(1),
    maxDepth: z.number().int().nonnegative().optional(),
  })
  .strict()

/** Import-aware call filter carried from the static syntax plan. */
export const NativeStaticParserCallInterestSchema = z
  .object({
    name: z.string().min(1),
    importFrom: z.array(z.string().min(1)).optional(),
    configArg: z.number().int().nonnegative().optional(),
    properties: z.array(z.string().min(1)).optional(),
    callbacks: z.array(NativeStaticParserCallbackInterestSchema).optional(),
    source: z.string().min(1).optional(),
  })
  .strict()

/** Import-aware constructor filter carried from the static syntax plan. */
export const NativeStaticParserConstructorInterestSchema = NativeStaticParserCallInterestSchema

/** Parser filters that must stay identical across prepare and analyze. */
export const nativeStaticParserInterestFields = {
  callNames: z.array(z.string().min(1)).optional(),
  callInterests: z.array(NativeStaticParserCallInterestSchema).optional(),
  constructorNames: z.array(z.string().min(1)).optional(),
  constructorInterests: z.array(NativeStaticParserConstructorInterestSchema).optional(),
  pruneNativeFactCallNames: z.array(z.string().min(1)).optional(),
} satisfies z.ZodRawShape

/** Parser callback interest. */
export type NativeStaticParserCallbackInterest = z.infer<typeof NativeStaticParserCallbackInterestSchema>

/** Parser call interest. */
export type NativeStaticParserCallInterest = z.infer<typeof NativeStaticParserCallInterestSchema>

/** Parser constructor interest. */
export type NativeStaticParserConstructorInterest = z.infer<typeof NativeStaticParserConstructorInterestSchema>
