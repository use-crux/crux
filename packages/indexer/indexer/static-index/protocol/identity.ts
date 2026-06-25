/**
 * Static Index compiler identity contracts.
 *
 * The identity captures every compiler-owned input that can affect Static
 * Index output or cache reuse. TypeScript owns this schema; Go and Rust mirror
 * it and verify their mirrors against the shared fixture manifest.
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
 * Canonical identity manifest for Static Index compiler-owned inputs.
 *
 * The manifest intentionally excludes per-project extension manifests. Runtime
 * callers add those when they build a concrete `StaticIndexRunIdentity`.
 */
export const StaticIndexIdentityManifestSchema = z
  .object({
    protocolVersion: z.literal(STATIC_INDEX_COMPILER_PROTOCOL_VERSION),
    compiler: StaticIndexIdentityComponentSchema,
    oxcFrontend: StaticIndexIdentityComponentSchema,
    primitiveManifest: StaticIndexIdentityComponentSchema,
    relationPolicy: StaticIndexIdentityComponentSchema,
    ruleDescriptors: StaticIndexIdentityComponentSchema,
    compilerProjection: StaticIndexIdentityComponentSchema,
  })
  .strict()

/** Static Index compiler-owned identity manifest. */
export type StaticIndexIdentityManifest = z.infer<typeof StaticIndexIdentityManifestSchema>

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
    ruleDescriptors: StaticIndexIdentityComponentSchema,
    compilerProjection: StaticIndexIdentityComponentSchema,
  })
  .strict()

/** Static Index compiler run identity. */
export type StaticIndexRunIdentity = z.infer<typeof StaticIndexRunIdentitySchema>

/** Options for deriving a run identity from the shared manifest. */
export interface CreateStaticIndexRunIdentityOptions<
  TExtensionManifests extends readonly StaticIndexIdentityComponent[] = readonly StaticIndexIdentityComponent[],
> {
  /** Extension manifests selected for the current project. */
  readonly extensionManifests?: TExtensionManifests
}

/**
 * Run identity shape produced from a Static Index identity manifest.
 *
 * This generic preserves literal manifest components for fixture code while
 * still satisfying the runtime `StaticIndexRunIdentity` protocol schema.
 */
export type StaticIndexRunIdentityFromManifest<
  TManifest extends StaticIndexIdentityManifest,
  TExtensionManifests extends readonly StaticIndexIdentityComponent[] = readonly StaticIndexIdentityComponent[],
> = Omit<
  StaticIndexRunIdentity,
  | 'protocolVersion'
  | 'compiler'
  | 'oxc'
  | 'primitiveManifest'
  | 'relationPolicy'
  | 'extensionManifests'
  | 'ruleDescriptors'
  | 'compilerProjection'
> & {
  readonly protocolVersion: TManifest['protocolVersion']
  readonly compiler: TManifest['compiler']
  readonly oxc: TManifest['oxcFrontend']
  readonly primitiveManifest: TManifest['primitiveManifest']
  readonly relationPolicy: TManifest['relationPolicy']
  readonly extensionManifests: TExtensionManifests
  readonly ruleDescriptors: TManifest['ruleDescriptors']
  readonly compilerProjection: TManifest['compilerProjection']
}

/**
 * Creates a concrete Static Index run identity from the shared manifest.
 *
 * @param manifest - Compiler-owned identity manifest from the contract spine.
 * @param options - Project-specific extension manifest identities.
 * @returns A request-ready identity with `oxcFrontend` mapped to protocol `oxc`.
 */
export function createStaticIndexRunIdentity<
  const TManifest extends StaticIndexIdentityManifest,
  const TExtensionManifests extends readonly StaticIndexIdentityComponent[] = readonly [],
>(
  manifest: TManifest,
  options: CreateStaticIndexRunIdentityOptions<TExtensionManifests> = {},
): StaticIndexRunIdentityFromManifest<TManifest, TExtensionManifests> {
  return {
    protocolVersion: manifest.protocolVersion,
    compiler: manifest.compiler,
    oxc: manifest.oxcFrontend,
    primitiveManifest: manifest.primitiveManifest,
    relationPolicy: manifest.relationPolicy,
    extensionManifests: (options.extensionManifests ?? []) as TExtensionManifests,
    ruleDescriptors: manifest.ruleDescriptors,
    compilerProjection: manifest.compilerProjection,
  }
}
