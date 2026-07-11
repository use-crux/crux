/**
 * Test utilities for Crux adapter contracts.
 *
 * - {@link providerRuntimeConformance} — the public runtime-level suite for
 *   adapters built with `defineSingleTurnProviderBundle()` or
 *   `defineProviderRuntime()`. It binds the runtime through `.create()` and
 *   covers both `single-turn` and `loop-owned` ownership.
 * - `describeCruxAdapterConformance` from
 *   `@use-crux/core/adapter/testing/vitest` — the Vitest wrapper used by
 *   provider packages.
 * - {@link adapterSpecConformance} and {@link loopRuntimePortConformance} —
 *   lower-level IR suites for compiler and core execution work.
 * - {@link fakeLoopRuntime} — a fully in-memory {@link LoopRuntimePort} you
 *   script with model emissions. Use it to test `loopRuntimeAdapter()` policy
 *   (routing, validation retry, approvals, steering) with zero SDK involvement.
 *
 * @module
 */

export { adapterSpecConformance } from './testing/native'
export { assertCanonicalResult } from './testing/canonical-result'
export {
  assertDirectMediaTranscriptIdentity,
  directMediaFixture,
  mediaConformanceFixture,
  wrongProviderFileMessages,
} from './testing/direct-media'
export {
  IMAGE_GENERATION_CONFORMANCE,
  imageGenerationConformanceRow,
  imageGenerationSupportProjection,
} from './testing/image-generation'
export { TRANSCRIPTION_CONFORMANCE, transcriptionConformanceRow } from './testing/transcription'
export { MEDIA_ADAPTER_MATRIX, mediaAdapterMatrixMarkdown } from './testing/media-matrix'
export { providerRuntimeConformance } from './testing/provider-runtime'
export { transcriptCodecConformance, transcriptRoundTripConformance } from './testing/transcript'
export type {
  DirectMediaFixture,
  DirectMediaProvider,
  MediaConformanceAdapter,
  MediaConformanceFixture,
} from './testing/direct-media'
export type {
  ImageGenerationConformanceRow,
  ImageGenerationFixtureAdapter,
} from './testing/image-generation'
export type { TranscriptionConformanceRow, TranscriptionFixtureAdapter } from './testing/transcription'
export type {
  CanonicalFinalStepInfo,
  CanonicalGenerateResultLike,
  CanonicalResultExpectation,
  CanonicalResultStepExpectation,
  CanonicalTokenUsage,
} from './testing/canonical-result'
export type {
  AdapterConformanceCapabilities,
  AdapterConformanceEmission,
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformancePrepared,
  AdapterConformanceScript,
} from './testing/native'
export type {
  ProviderConformanceEmission,
  ProviderConformancePrepared,
  ProviderConformanceScript,
  ProviderRuntimeConformanceCapabilities,
  ProviderRuntimeConformanceGenerateOptions,
  ProviderRuntimeConformanceGenerateResult,
  ProviderRuntimeConformanceHarness,
  ProviderRuntimeConformanceRuntime,
  ProviderRuntimeConformanceStreamHandle,
} from './testing/provider-runtime'
export type {
  TranscriptConformanceScenario,
  TranscriptRoundTripConformanceSuite,
  TranscriptRoundTripFixture,
  TranscriptWrapperExpectation,
} from './testing/transcript'

// Loop runtime test double + contract suite (SDK-driven loop).
export { fakeLoopRuntime } from './testing/fake-loop-runtime'
export type {
  FakeLoopEmission,
  FakeLoopRuntime,
  FakeLoopRuntimeConfig,
  FakeRawResponse,
  FakeRawStream,
} from './testing/fake-loop-runtime'
export { loopRuntimePortConformance } from './testing/loop-runtime-conformance'
export type { ConformanceViolation, LoopRuntimeConformanceHarness } from './testing/loop-runtime-conformance'
