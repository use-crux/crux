/**
 * Static Index compiler identity contracts.
 *
 * The identity captures every compiler-owned input that can affect Static
 * Index output or cache reuse. Protocol method strings are still renamed in a
 * later cross-language phase, but this TypeScript owner already uses the final
 * Static Index vocabulary.
 *
 * @module
 */

import { z } from 'zod'

/** Current Static Index compiler protocol version. */
export const STATIC_INDEX_COMPILER_PROTOCOL_VERSION = 1 as const

/** Cache-sensitive identity for one compiler input component. */
export const StaticIndexIdentityComponentSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().min(1).optional(),
  })
  .strict()

/** Identity component used by Static Index cache and protocol validation. */
export type StaticIndexIdentityComponent = z.infer<typeof StaticIndexIdentityComponentSchema>

/**
 * Versioned identity for every compiler input that can affect Static Index
 * output or cache reuse.
 */
export const StaticIndexRunIdentitySchema = z
  .object({
    protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
    compiler: StaticIndexIdentityComponentSchema,
    oxc: StaticIndexIdentityComponentSchema,
    primitiveManifest: StaticIndexIdentityComponentSchema,
    relationPolicy: StaticIndexIdentityComponentSchema,
    extensionManifests: z.array(StaticIndexIdentityComponentSchema),
    firstPartyGraphRules: StaticIndexIdentityComponentSchema,
    compilerProjection: StaticIndexIdentityComponentSchema,
  })
  .strict()

/** Static Index compiler run identity. */
export type StaticIndexRunIdentity = z.infer<typeof StaticIndexRunIdentitySchema>
