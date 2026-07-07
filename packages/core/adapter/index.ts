/**
 * `@use-crux/core/adapter` — Provider adapter abstraction.
 *
 * Shared infrastructure for building AI provider adapters. Public provider
 * authors should start with provider runtimes:
 *
 * - {@link defineSingleTurnProviderBundle} — for raw provider SDKs without a
 *   tool loop (Anthropic, OpenAI, Google). Core drives the loop one provider
 *   call at a time.
 * - {@link defineProviderRuntime} with `ownership: 'loop-owned'` and `loop`
 *   — for orchestrating SDKs that own their own multi-step loop (the Vercel
 *   AI SDK). The SDK drives; core steers each step through a `StepObserver`.
 *
 * Both dialects drive the same per-call sessions — the `ToolLifecycle` session
 * from `@use-crux/core/adapter/tool` (middleware, approvals, instrumentation,
 * skill loads, memory capture) and the `Safety` session from
 * `@use-crux/core/safety` — so policy semantics never diverge between dialects.
 * Test public provider runtimes with {@link providerRuntimeConformance}. Use
 * {@link fakeLoopRuntime}, {@link adapterSpecConformance}, and
 * {@link loopRuntimePortConformance} for lower-level execution IR tests.
 *
 * @module
 */

// Core types
export type {
  AdapterResponse,
  CallArgs,
  StreamHandle,
  ToolResultEntry,
  StatusDelta,
} from "./types";
export { callArgsFromResolvedPrompt } from "./codec";
export type { ResolvedPromptCodecOptions } from "./codec";

// Adapter specification interface (core-driven loop)
export type { AdapterSpec } from "./spec";

// Factory + result/option types (core-driven loop)
export { adapter } from "./define-adapter";
export { createResultAccumulator } from "./result-accumulator";
export { CruxIncompleteCallError, CruxStaleHandleError } from "./call-handle";
export { CruxTransportStreamUnsupportedError } from "./transport";
export type {
  CruxAdapter,
  AdapterGenerateOptions,
  AdapterStreamOptions,
  AdapterGenerateResult,
  AdapterTransport,
  AdapterTransportInfo,
} from "./define-adapter";
export type {
  FinalStepInfo,
  GenerateResult,
  StreamCompletion,
  StreamResult,
} from "./result-accumulator";
export type {
  CallHandle,
  CallHandleResponseDecoder,
  CallStepOutcome,
} from "./call-handle";

// Native single-turn provider contracts
export type {
  NativeAssistantTurn,
  NativeChatHelpers,
  NativeChatRequestArgs,
  NativeProviderPort,
  NativeResponseMetadata,
  NativeTranscriptCodec,
} from "./native-chat";

// Canonical transcript IR and the codec compiler built on it
export {
  appendCanonicalToolRound,
  appendNativeToolRound,
  createToolResultEncodingHelpers,
  defineProviderTranscriptCodec,
  messagesToTranscriptUnits,
  transcriptUnitsToMessages,
} from "./native-chat";
export type {
  OneOrMany,
  ProviderToolCall,
  ProviderToolResult,
  ProviderTranscriptDialect,
  ProviderTranscriptUnit,
  ToolResultEncodingHelpers,
} from "./native-chat";

// Tool approval policy helpers
export {
  approvalPolicyKind,
  inspectToolApprovalPolicies,
  resolveApprovalPolicy,
} from "../tools/approval-policy";
export type {
  ApprovalDeclaration,
  ResolvedApprovalPolicy,
  ToolApprovalContext,
  ToolApprovalInspection,
  ToolApprovalLayer,
  ToolApprovalMap,
  ToolApprovalPolicy,
} from "../tools/approval-policy";

// Provider runtime authoring layer
export { defineProviderRuntime } from "./provider-runtime";
export { defineSingleTurnProviderBundle } from "./provider-runtime";
export type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  DefinedSingleTurnProviderBundle,
  LoopOwnedProviderRuntime,
  LoopOwnedProviderRuntimeSpec,
  LoopOwnedRuntimeBindContext,
  LoopOwnedRuntimeContract,
  ProviderOwnership,
  ProviderRuntimeDepsArg,
  ProviderRuntimeKind,
  ProviderRuntimeExtension,
  ProviderRuntimeExtensionCollisionKeys,
  ProviderRuntimeExtensionContext,
  ProviderRuntimeExtender,
  ProviderRuntimeSpec,
  SingleTurnProviderBundleDeps,
  SingleTurnProviderBundleSpec,
  SingleTurnRuntimeContract,
  SingleTurnProviderRuntimeSpec,
} from "./provider-runtime";

// Loop runtime port (SDK-driven loop)
export type {
  LoopRuntimePort,
  BoundLoopRuntime,
  CachedStreamPayload,
} from "./loop-runtime-port";
export type {
  ExecutorRequest,
  StructuredRequest,
  ExecutorStep,
  StepDirective,
  StepObserver,
  ExecutorOutcome,
  ExecutorMeta,
  PendingToolApproval,
  StructuredAttempt,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
} from "./executor-types";

// Factory + result/option types (SDK-driven loop)
export { loopRuntimeAdapter } from "./define-executor";
export type {
  CruxExecutor,
  ExecutorModelArg,
  ExecutorGenerateOptions,
  ExecutorStreamOptions,
  ExecutorGenerateResult,
} from "./define-executor";

// Shared policy modules (used by both factories; public so executors built
// outside core can reuse the exact same policy primitives)
export {
  validateStructuredOutput,
  formatValidationFeedback,
} from "./policy/validation-retry";
export type { ValidationResult } from "./policy/validation-retry";

// Generic measurement/serialization helpers (not tool policy)
export {
  isToolModelOutput,
  measureModelOutput,
  measureUnknown,
  renderToolContentPartAsText,
  toJsonValue,
  toolModelOutputFromMetadata,
} from "./tool/emission";

// The per-call tool lifecycle session — the single consumption entry point
// for tool middleware, approvals, instrumentation, skill loads, and memory
// capture. The orchestration primitives it replaced (instrumentToolSet,
// the approval id/token/message helpers, resume scanning, …) are session
// internals now.
export { createToolLifecycle } from "./tool";
export type {
  ToolLifecycle,
  ToolLifecycleOptions,
  ToolDescriptor,
  AppendToolRound,
  ToolResumeOutcome,
  ToolRoundOutcome,
  SkillAmendment,
  SuspendedRound,
  ToolProtocolEvent,
} from "./tool";
export type { ApprovalRequestInfo } from "./tool/approval";

// Replay seam (@internal) — the process-wide generation interceptor the
// Quality cassette runtime installs around every spec call. Exported so
// adapter packages can test their replayed-result shapes against it.
export {
  setGenerationInterceptor,
  clearGenerationInterceptor,
} from "./interception";
export type {
  GenerationInterceptor,
  InterceptedGeneration,
} from "./interception";

// Testing utilities for public provider runtimes and lower-level execution IR.
export {
  assertCanonicalResult,
  adapterSpecConformance,
  fakeLoopRuntime,
  loopRuntimePortConformance,
  providerRuntimeConformance,
  transcriptCodecConformance,
} from "./testing";
export type {
  AdapterConformanceCapabilities,
  AdapterConformanceEmission,
  AdapterConformanceHarness,
  AdapterConformanceInspector,
  AdapterConformancePrepared,
  AdapterConformanceScript,
  CanonicalFinalStepInfo,
  CanonicalGenerateResultLike,
  CanonicalResultExpectation,
  CanonicalResultStepExpectation,
  CanonicalTokenUsage,
  FakeLoopRuntime,
  FakeLoopRuntimeConfig,
  FakeLoopEmission,
  FakeRawResponse,
  FakeRawStream,
  LoopRuntimeConformanceHarness,
  ConformanceViolation,
  ProviderConformanceEmission,
  ProviderConformancePrepared,
  ProviderConformanceScript,
  ProviderRuntimeConformanceCapabilities,
  ProviderRuntimeConformanceGenerateOptions,
  ProviderRuntimeConformanceGenerateResult,
  ProviderRuntimeConformanceHarness,
  ProviderRuntimeConformanceRuntime,
  ProviderRuntimeConformanceStreamHandle,
  TranscriptConformanceScenario,
  TranscriptWrapperExpectation,
} from "./testing";
