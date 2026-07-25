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
  StreamCompletionMetadata,
  LogicalBillingTotals,
  ToolResultEntry,
  StatusDelta,
} from "./types";
export { callArgsFromResolvedPrompt } from "./codec";
export type { ResolvedPromptCodecOptions } from "./codec";

// Adapter specification interface (core-driven loop)
export type { AdapterSpec } from "./spec";

// Normalized, provider-neutral outcome taxonomy (finish reason + errors)
export {
  classifyProviderHttpError,
  CruxAdapterError,
  cruxProviderError,
  isCruxAdapterError,
  normalizeAdapterCallError,
  redactProviderMessage,
} from "./normalized-outcome";
export type {
  CruxFinishReason,
  CruxProviderError,
  CruxProviderErrorInput,
  CruxProviderErrorKind,
  NormalizeAdapterCallErrorOptions,
} from "./normalized-outcome";

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
  AdapterStreamResult,
  AdapterTransport,
  AdapterTransportInfo,
} from "./define-adapter";
export type {
  FinalStepInfo,
  GenerateResult,
  GenerateResultPayload,
  StreamCompletion,
  StreamCompletionPayload,
} from "./result-accumulator";
export type {
  CallHandle,
  CallHandleResponseDecoder,
  CallStepOutcome,
} from "./call-handle";

// Native single-turn provider contracts
export type {
  NativeAssistantTurn,
  NativeAssistantReadContext,
  NativeChatHelpers,
  NativeChatRequestArgs,
  NativeProviderPort,
  NativeResponseMetadata,
  NativeTranscriptCodec,
} from "./native-chat";

// Structured-output capability profiles. Provider packages declare which JSON
// Schema behavior they accept; core owns the finite lowering rules. Inert data
// only — no executable rewrite hooks.
export type {
  AdditionalPropertiesSupport,
  JsonSchemaObject,
  StructuredOutputCapabilities,
  StructuredOutputDecodeManifest,
  StructuredOutputDecodeOperation,
  StructuredOutputDiagnostic,
  StructuredOutputPlan,
} from "./structured-output";
// The core-owned compiler and decoder. Narrowly exported for provider codecs
// that assemble native request params outside the core execution loop.
export {
  compileStructuredOutput,
  decodeStructuredValue,
  CruxInvalidCapabilityProfileError,
  CruxStructuredOutputDecodeError,
  CruxUnsupportedSchemaError,
  CruxUnsupportedStructuredOutputError,
} from "./structured-output";

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
  TranscriptEncodeOptions,
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
export {
  bindCompletedOperation,
  defineCompletedOperation,
  runCompletedMediaOperation,
} from "./completed-operation";
export type {
  BindCompletedOperationOptions,
  BoundCompletedOperation,
  CompletedOperationCall,
  CompletedOperationModel,
  CompletedMediaOperationResult,
  CompletedOperationPayload,
  GenerateImagePayload,
  GenerateSpeechPayload,
  TranscriptionPayload,
  CompletedOperationConformanceCase,
  CompletedOperationContext,
  CompletedOperationDefinition,
  CompletedOperationInvokeContext,
  CompletedOperationReport,
  RunCompletedMediaOperationOptions,
} from "./completed-operation";
export type {
  DefinedProviderRuntime,
  DefinedSingleTurnProviderRuntime,
  DefinedSingleTurnProviderBundle,
  LoopOwnedProviderRuntime,
  LoopOwnedProviderRuntimeSpec,
  LoopOwnedRuntimeBindContext,
  LoopOwnedRuntimeContract,
  ProviderOwnership,
  ProviderCompletedOperationFactories,
  ProviderCompletedOperationFactory,
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
  ExecutorModelStep,
  StepContentEdit,
  StepTransformer,
  StepDirective,
  StepObserver,
  ExecutorOutcome,
  ExecutorMeta,
  PendingToolApproval,
  StructuredAttempt,
  ExecutorProviderStreamHandle,
  ExecutorStreamCompletionPayload,
  ExecutorStreamHandle,
  ExecutorStreamMeta,
} from "./executor-types";
/**
 * The coordinated-stream attempt port (RFC #173). A loop-owning runtime executes this
 * core-owned plan to discard and restream a rejected attempt; core owns retry policy.
 * @internal
 */
export type {
  CoordinatedStreamPlan,
  SdkStreamAttempt,
  SdkAttemptOutcome,
} from "./execution/stream-attempt-plan";
/**
 * @internal Type-guarded classification of an internal non-terminal attempt rejection,
 * so a loop-owning runtime never has to compare `error.name` (which a provider error can
 * spoof) to decide whether a failure is a policy decision.
 */
export { isStreamAttemptRejection } from "./execution/stream-rejection";
export { toolModelIngressDialect } from "./tool/model-ingress-port";
export type { ToolModelIngressDialect } from "./tool/model-ingress-port";
/** @internal Private dialect hook for guarded active-history amendments. */
export { systemMessagePrefixPatch } from "./execution/system-prefix-patch";
/** @internal Private dialect contract for guarded active-history amendments. */
export type { SystemMessagePrefixPatch } from "./execution/system-prefix-patch";
export type {
  ModelIngressDocument,
  ModelIngressMediaSlot,
  ModelIngressOpaqueSlot,
  ModelIngressPatch,
  ModelIngressSlot,
  ModelIngressSlotKey,
  ModelIngressTextSlot,
} from "../safety/input/model-ingress-document";
export type {
  CanonicalModelIngress,
  CanonicalModelIngressResult,
  CanonicalTextIngress,
  CanonicalTextIngressResult,
  ModelIngressGuard,
  ToolModelInputOrigin,
} from "../safety/input/model-ingress";

// Factory + result/option types (SDK-driven loop)
export { loopRuntimeAdapter } from "./define-executor";
export type {
  CruxExecutor,
  ExecutorModelArg,
  ExecutorGenerateOptions,
  ExecutorStreamOptions,
  ExecutorGenerateResult,
  ExecutorStreamResult,
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

/**
 * The managed logical stream contract (RFC #173): one provider-neutral `stream()` result
 * whose physical attempts, provider framing, and rejected content are never observable.
 */
export type {
  AsyncIterableStream,
  DeepPartial,
  PublishedStreamEvent,
  StreamEvent,
  StreamResult,
  StreamSource,
} from "./logical-stream";
export { createCanonicalPartialProjector } from "./execution/canonical-partials";
export { publishOrdinaryStream } from "./execution/logical-stream-mapping";
export type { PublishOrdinaryStreamOptions } from "./execution/logical-stream-mapping";
/**
 * Caller callbacks over the PUBLISHED logical sequence. None is ever installed on
 * a physical provider attempt, so a discarded attempt invokes none of them.
 */
export type { LogicalStreamCallbacks } from "./logical-stream-publisher";
