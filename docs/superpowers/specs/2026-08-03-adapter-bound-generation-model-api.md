# Adapter-Bound Generation Model API Contract

Status: **approved API direction awaiting user specification review for issue #338**

Illustrative TypeScript surface for the
[adapter-bound generation model design](./2026-08-03-adapter-bound-generation-model-design.md).
Behavioral authority remains there. Signatures are specification illustrations,
not published package source.

## Core contract

Core owns provider-neutral value, identity, capability, and resolution
contracts. Adapter packages own native types and execution.

```ts
export type GenerationOperation =
  | 'language' | 'image' | 'speech' | 'transcription' | 'embedding'
export type LanguageCapability =
  | 'text-input' | 'image-input' | 'audio-input' | 'file-input'
  | 'text-output' | 'structured-output' | 'tool-calls'
  | 'parallel-tool-calls' | 'streaming'
export type ImageCapability =
  | 'text-input' | 'image-input' | 'multiple-output' | 'streaming'
export type SpeechCapability = 'text-input' | 'voice' | 'streaming'
export type TranscriptionCapability =
  | 'audio-input' | 'timestamps' | 'diarization'
export type EmbeddingCapability =
  | 'text-input' | 'image-input' | 'batching' | 'dimensions'

/**
 * Complete provider-neutral capability declaration.
 * Empty tuples mean unsupported; literal tuples are retained.
 *
 * @example
 * ```ts
 * const capabilities = {
 *   contract: 'crux.generation-capabilities.v1',
 *   language: ['text-input', 'text-output', 'tool-calls'] as const,
 *   image: [], speech: [], transcription: [], embedding: [],
 * } satisfies GenerationCapabilities
 * ```
 */
export interface GenerationCapabilities {
  readonly contract: 'crux.generation-capabilities.v1'
  readonly language: readonly LanguageCapability[]
  readonly image: readonly ImageCapability[]
  readonly speech: readonly SpeechCapability[]
  readonly transcription: readonly TranscriptionCapability[]
  readonly embedding: readonly EmbeddingCapability[]
}

export interface GenerationAdapterIdentity {
  readonly id: string
  /**
   * Durable execution-contract version, not an npm/package version.
   * Changes only with durable semantic or compatibility changes.
   */
  readonly version: string
}

export interface GenerationModelDefinition {
  readonly id: string
  /** Stable semantic binding-compatibility fingerprint for hard replay checks. */
  readonly fingerprint: string
}

export type NormalizedGenerationIdentity =
  | { readonly kind: 'model'; readonly model: string }
  | {
      readonly kind: 'router'
      readonly router: string
      readonly routes: readonly {
        readonly key: string
        readonly target: string
      }[]
    }

declare const generationRuntime: unique symbol

/**
 * Frozen adapter-bound model with an opaque adapter execution port.
 * The native object remains adapter-owned and is never made durable.
 *
 * @example
 * ```ts
 * export const balanced = aiSdk(nativeModel('ember-reason-v1'))
 * ```
 */
export interface AdapterBoundGenerationModel<
  TNative = unknown,
  TCapabilities extends GenerationCapabilities = GenerationCapabilities,
> {
  readonly _tag: 'crux.generation-model'
  readonly adapter: GenerationAdapterIdentity
  readonly native: TNative
  readonly definition: GenerationModelDefinition
  readonly identity: NormalizedGenerationIdentity
  readonly capabilities: TCapabilities
  readonly [generationRuntime]: GenerationRuntimePort
}

/** Adapter-bound leaf, or Core router/fallback whose reachable leaves are bound. */
export type GenerationModel =
  | AdapterBoundGenerationModel
  | BoundRouterModel
  | BoundFallbackModel

/** Exact capability type retained from a leaf or safe route intersection. */
export type CapabilitiesOf<M extends GenerationModel> =
  /* recursive literal intersection */
```

Freezing covers the returned wrapper and Core metadata. Adapters implement the
opaque `GenerationRuntimePort`.

## Adapter-authoring seam

Adapters cannot assign the opaque `generationRuntime` symbol directly. Core
exports this seam from its adapter-authoring entry point for provider packages
only:

```ts
/**
 * Install Core metadata and the opaque runtime port for one adapter-bound model.
 * Validates and freezes Core-owned fields. Not a user-facing executor escape
 * hatch and not a registry.
 *
 * @example
 * ```ts
 * return defineGenerationModel({
 *   adapter: { id: 'ai-sdk', version: '1' },
 *   native,
 *   definition: { id, fingerprint },
 *   identity,
 *   capabilities,
 *   runtime: createAiSdkRuntimePort(native),
 * })
 * ```
 */
export declare function defineGenerationModel<
  const TNative,
  const TCapabilities extends GenerationCapabilities,
>(spec: {
  readonly adapter: GenerationAdapterIdentity
  readonly native: TNative
  readonly definition: GenerationModelDefinition
  readonly identity: NormalizedGenerationIdentity
  readonly capabilities: TCapabilities
  readonly runtime: GenerationRuntimePort
}): AdapterBoundGenerationModel<TNative, TCapabilities>
```

Public binding functions call this after deriving identity and capabilities.
Application code never imports it to bypass binding or inject an executor.

## Adapter package: `aiSdk`

Every adapter exposes exactly one public one-argument binding function beside
its existing direct generation functions:

```ts
/**
 * Adapter-owned source covering every native operation model and same-adapter
 * router this package supports. Unsupported operation families remain empty
 * capability tuples on the returned value.
 */
export type AiSdkGenerationSource =
  | AiSdkNativeModel
  | SameAdapterRouter<AiSdkNativeModel>

/**
 * Bind a native model or same-adapter router to portable execution authority.
 * One argument only: the adapter owns its typed capability catalog.
 *
 * @example
 * ```ts
 * export const fast = aiSdk(nativeModel('nebula-text-v2'))
 * export const routed = aiSdk(router({
 *   id: 'quality-route',
 *   classify: ({ context }) => context.quality,
 *   routes: { fast: nativeFast, deep: nativeDeep, default: nativeFast },
 * }))
 * ```
 */
export declare function aiSdk<const TNative extends AiSdkGenerationSource>(
  native: TNative,
): AdapterBoundGenerationModel<TNative, AiCapabilitiesOf<TNative>>
```

Other adapters use the same one-argument shape under their own package function
name. Literal native evidence can yield exact readonly capability tuples via
`AiCapabilitiesOf<TNative>`; broad native interfaces yield conservative static
evidence and require generated-program preflight. At runtime the adapter derives
and validates complete capabilities from native identity, metadata, and its
catalog—callers never supply capabilities. Returns a frozen value via
`defineGenerationModel` and does not register anything.

Raw adapter-native models remain valid only on adapter-owned calls; durable APIs
accept only `GenerationModel`. Cross-adapter routing composes already-bound
leaves—do not wrap a cross-adapter router with one adapter function.

## Session type contract

Exact Agent and Session signatures, options inference, capability guards, and
related rules live in the
[adapter-bound generation model session types](./2026-08-03-adapter-bound-generation-model-session-types.md)
spec. That document owns those details; this API contract does not restate them.
