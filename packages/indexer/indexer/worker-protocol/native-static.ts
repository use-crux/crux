/**
 * Native static compiler protocol contracts.
 *
 * These schemas describe the internal Go/Rust/TypeScript handoff that will
 * replace the syntax-record bridge. They are intentionally fact- and
 * evidence-shaped: the protocol carries JSON-safe Crux data, never TypeScript
 * or Oxc AST objects.
 *
 * @module
 */

import { z } from 'zod'
import { nativeStaticParserInterestFields } from './native-static-parser-interests'

/** Current native static compiler protocol version. */
export const NATIVE_STATIC_COMPILER_PROTOCOL_VERSION = 1 as const

/** Native static compiler method names used on the JSON-lines boundary. */
export type NativeStaticCompilerMethod =
  | 'nativeStaticPrepare'
  | 'nativeStaticAnalyze'
  | 'nativeStaticFinalize'
  | 'nativeStaticCompile'

const identityComponentSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().min(1).optional(),
  })
  .strict()

const nonNegativeNumber = z.number().finite().nonnegative()
const unknownArraySchema = z.array(z.unknown())

/**
 * Versioned identity for every compiler input that can affect native static
 * output or cache reuse.
 */
export const NativeStaticRunIdentitySchema = z
  .object({
    protocolVersion: z.literal(NATIVE_STATIC_COMPILER_PROTOCOL_VERSION),
    compiler: identityComponentSchema,
    oxc: identityComponentSchema,
    primitiveManifest: identityComponentSchema,
    relationPolicy: identityComponentSchema,
    extensionManifests: z.array(identityComponentSchema),
    firstPartyGraphRules: identityComponentSchema,
    compilerProjection: identityComponentSchema,
  })
  .strict()

/** Native static compiler run identity. */
export type NativeStaticRunIdentity = z.infer<typeof NativeStaticRunIdentitySchema>

/**
 * Machine-readable telemetry emitted by each native static stage.
 *
 * Go benchmarks and devtools diagnostics use this to explain whether Node was
 * required, why native-only eligibility failed, and how many files/facts/cache
 * entries moved through the stage.
 */
export const NativeStaticTelemetrySchema = z
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

/** Native static stage telemetry. */
export type NativeStaticTelemetry = z.infer<typeof NativeStaticTelemetrySchema>

/** Source file identity selected for native static planning. */
export const NativeStaticSourceFileSchema = z
  .object({
    file: z.string().min(1),
    sourceHash: z.string().min(1),
    cacheKey: z.string().min(1).optional(),
  })
  .strict()

export type NativeStaticSourceFile = z.infer<typeof NativeStaticSourceFileSchema>

/** Source file selected for native static analysis. */
export const NativeStaticFileInputSchema = z
  .object({
    file: z.string().min(1),
    sourceHash: z.string().min(1),
    sourceText: z.string().optional(),
  })
  .strict()

export type NativeStaticFileInput = z.infer<typeof NativeStaticFileInputSchema>

/** Normalized native static source plan shared by prepare and analyze. */
export const NativeStaticPreparedPlanSchema = z
  .object({
    root: z.string().min(1),
    projectName: z.string().min(1).optional(),
    files: z.array(NativeStaticSourceFileSchema),
    /** Extraction owners inside the wider parse set. */
    primaryFiles: z.array(NativeStaticSourceFileSchema).optional(),
    cacheHits: z.array(NativeStaticSourceFileSchema),
    cacheMisses: z.array(NativeStaticSourceFileSchema),
    ...nativeStaticParserInterestFields,
  })
  .strict()

export type NativeStaticPreparedPlan = z.infer<typeof NativeStaticPreparedPlanSchema>

const nativeStaticRequestBase = {
  protocolVersion: z.literal(NATIVE_STATIC_COMPILER_PROTOCOL_VERSION),
  identity: NativeStaticRunIdentitySchema,
} as const

const nativeStaticResponseBase = {
  protocolVersion: z.literal(NATIVE_STATIC_COMPILER_PROTOCOL_VERSION),
  diagnostics: unknownArraySchema,
  telemetry: NativeStaticTelemetrySchema,
} as const

/** Request for the Rust compiler to normalize source/cache planning input. */
export const NativeStaticPrepareRequestSchema = z
  .object({
    ...nativeStaticRequestBase,
    method: z.literal('nativeStaticPrepare'),
    root: z.string().min(1),
    projectName: z.string().min(1).optional(),
    configPath: z.string().min(1).optional(),
    files: z.array(NativeStaticSourceFileSchema),
    /** Extraction owners inside the wider parse set. */
    primaryFiles: z.array(NativeStaticSourceFileSchema).optional(),
    ...nativeStaticParserInterestFields,
    cacheInputs: unknownArraySchema.optional(),
    extensionHost: z.unknown().optional(),
  })
  .strict()

/** Response from native static prepare. */
export const NativeStaticPrepareResponseSchema = z
  .object({
    ...nativeStaticResponseBase,
    method: z.literal('nativeStaticPrepare'),
    plan: NativeStaticPreparedPlanSchema,
  })
  .strict()

/** Request for the Rust compiler to parse selected cache misses and emit facts/evidence. */
export const NativeStaticAnalyzeRequestSchema = z
  .object({
    ...nativeStaticRequestBase,
    method: z.literal('nativeStaticAnalyze'),
    stream: z.literal(true),
    plan: NativeStaticPreparedPlanSchema,
    files: z.array(NativeStaticFileInputSchema),
    extensionEvidenceInterests: z.unknown().optional(),
  })
  .strict()

/** Response from native static analyze. */
export const NativeStaticAnalyzeResponseSchema = z
  .object({
    ...nativeStaticResponseBase,
    method: z.literal('nativeStaticAnalyze'),
    facts: unknownArraySchema,
    extensionEvidenceJobs: unknownArraySchema,
  })
  .strict()

/** Request for native relation/rule/cache finalization. */
export const NativeStaticFinalizeRequestSchema = z
  .object({
    ...nativeStaticRequestBase,
    method: z.literal('nativeStaticFinalize'),
    stream: z.literal(true).optional(),
    nativeFacts: unknownArraySchema,
    extensionFacts: unknownArraySchema,
    /** Post-merge facts used by native lint evaluation but not re-emitted. */
    lintFacts: unknownArraySchema.optional(),
    relationSpecs: z.unknown().optional(),
    ruleResults: z.unknown().optional(),
    lintConfig: z.unknown().optional(),
    lintFiles: z.array(z.string()).optional(),
    emitBuiltinLints: z.boolean().optional(),
    patchPhase: z.enum(['ast', 'semantic', 'runtime', 'quality']).optional(),
    patchInvalidates: z.unknown().optional(),
    cache: z.unknown().optional(),
  })
  .strict()

/** Response from native static finalization. */
export const NativeStaticFinalizeResponseSchema = z
  .object({
    protocolVersion: z.literal(NATIVE_STATIC_COMPILER_PROTOCOL_VERSION),
    method: z.literal('nativeStaticFinalize'),
    events: unknownArraySchema,
    telemetry: NativeStaticTelemetrySchema,
  })
  .strict()

/** Request for native-only parse, relation/rule finalization, and streamed patch events. */
export const NativeStaticCompileRequestSchema = z
  .object({
    ...nativeStaticRequestBase,
    method: z.literal('nativeStaticCompile'),
    stream: z.literal(true),
    plan: NativeStaticPreparedPlanSchema,
    files: z.array(NativeStaticFileInputSchema),
    nativeFacts: unknownArraySchema,
    extensionFacts: unknownArraySchema,
    relationSpecs: z.unknown().optional(),
    lintConfig: z.unknown().optional(),
    lintFiles: z.array(z.string()).optional(),
    emitBuiltinLints: z.boolean().optional(),
  })
  .strict()

/** Response from native-only streamed compilation. */
export const NativeStaticCompileResponseSchema = z
  .object({
    protocolVersion: z.literal(NATIVE_STATIC_COMPILER_PROTOCOL_VERSION),
    method: z.literal('nativeStaticCompile'),
    events: unknownArraySchema,
    telemetry: NativeStaticTelemetrySchema,
  })
  .strict()

/** Native static compiler request union. */
export const NativeStaticCompilerRequestSchema = z.discriminatedUnion('method', [
  NativeStaticPrepareRequestSchema,
  NativeStaticAnalyzeRequestSchema,
  NativeStaticFinalizeRequestSchema,
  NativeStaticCompileRequestSchema,
])

/** Native static compiler response union. */
export const NativeStaticCompilerResponseSchema = z.discriminatedUnion('method', [
  NativeStaticPrepareResponseSchema,
  NativeStaticAnalyzeResponseSchema,
  NativeStaticFinalizeResponseSchema,
  NativeStaticCompileResponseSchema,
])

export type NativeStaticCompilerRequest = z.infer<typeof NativeStaticCompilerRequestSchema>

export type NativeStaticCompilerResponse = z.infer<typeof NativeStaticCompilerResponseSchema>
