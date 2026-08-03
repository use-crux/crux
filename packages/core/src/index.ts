/**
 * `@use-crux/core` — SDK-agnostic prompt composition and context engineering.
 *
 * Provides composable, portable prompt abstractions that work with any AI SDK.
 * Compose prompts once, execute with any adapter.
 *
 * **Core API:**
 * - `signal()` — Declare and publish typed process-local Signal occurrences
 * - `prompt()` — Compose typed, SDK-agnostic prompts with contexts and schemas
 * - `context()` — Create reusable typed fragments that contribute to system messages
 * - `createPrompts()` — Organize prompts into a nested tree with IDE autocomplete
 * - `createContexts()` — Organize contexts into a nested tree with IDE autocomplete
 * - `config()` — Single entry point for configuration (devtools, middleware, evals, etc.)
 *
 * **Resolution & Inspection:**
 * - `.resolve()` — Get SDK-agnostic resolved prompt data (system, prompt, schema, tools)
 * - `preview()` — Measure a prospective request without executing it
 *
 * **Adapter packages (execution):**
 * - `@use-crux/ai` — Vercel AI SDK adapter (`generate()`, `stream()`)
 * - `@use-crux/openai` — OpenAI SDK adapter (`createOpenAI()`)
 * - `@use-crux/google` — Google GenAI adapter (`createGoogle()`)
 *
 * **Other subpaths:**
 * - `@use-crux/core/eval` — inert Eval authoring with `evaluate()` and `caseFile()`
 * - `@use-crux/core/observability` — `enableDevtools()` for local canonical observability delivery
 * @example
 * ```ts
 * // crux.config.ts
 * import { config, prompt, context, createPrompts } from '@use-crux/core'
 * import { z } from 'zod'
 *
 * const brand = context({
 *   priority: 30,
 *   input: z.object({ brandContext: z.string().optional() }),
 *   system: ({ input }) =>
 *     input.brandContext ? `## Brand\n${input.brandContext}` : '',
 * })
 *
 * const edit = prompt({
 *   id: 'edit',
 *   use: [brand],
 *   input: z.object({ instruction: z.string() }),
 *   output: z.object({ edits: z.array(z.string()) }),
 *   system: 'You are an editor.',
 *   prompt: ({ input }) => input.instruction,
 * })
 *
 * export default config({
 *   devtools: { serverUrl: process.env.DEVTOOLS_URL },
 * })
 * ```
 *
 * @module
 */

// Core definition API (prompt authoring domain)
export { signal } from "./signal";
export {
  prompt,
  context,
  createContexts,
  when,
  match,
  contributor,
  isContributorEntry,
} from "./prompt";
export type { ContributorConfig } from "./prompt";
export type { Contribution, ContributorEntry } from "./prompt";
export { md } from "./prompt-text";
export type { PromptText } from "./prompt-text";
export { compilePrompt } from "./resolver/compile";
export type {
  CompiledPrompt,
  CompilePromptOptions,
  PromptResolution,
  PromptResolutionPipeline,
  Resolution,
  ResolveCallOptions,
} from "./resolver/compile";
// In-memory fakes for every resolver port — the same deterministic seams the
// core test suite uses, for SDK consumers testing resolution without global
// runtime/observability setup.
export {
  recordingObservability,
  inMemorySkillSource,
  inMemoryContextCache,
  fixedClock,
  collectingDiagnostics,
  staticPolicy,
  recordingInstrumentation,
  staticTokenizer,
  createResolverFakes,
} from "./resolver/fakes";
export type {
  RecordedArtifact,
  RecordingObservability,
  InMemorySkillSource,
  FixedClock,
  InMemoryContextCache,
  CollectingDiagnostics,
  RecordingInstrumentation,
  ResolverFakes,
  ResolverFakesOptions,
} from "./resolver/fakes";
// Test helper: a conformant in-memory `AgentExecutor` for composition tests
// (the agent-layer analogue of the resolver fakes above).
export { createFakeAgentExecutor } from "./agent/fakes";
export type {
  FakeAgentExecutor,
  FakeAgentExecutorConfig,
  FakeAgentBehavior,
  FakeAgentBehaviorResolver,
  FakeAgentInvocation,
  FakeAgentUsage,
} from "./agent/fakes";
export type {
  ClockPort,
  ContextCacheHit,
  ContextCachePort,
  DiagnosticsPort,
  InstrumentationPort,
  ObservabilityPort,
  ResolveArtifact,
  ResolvedRegistrySkill,
  ResolvePolicy,
  ResolverPorts,
  ResolveTraceScope,
  SkillSourcePort,
  TokenizerPort,
} from "./resolver/ports";
// The contributor contract types — the lowered form every `use:` entry
// resolves through internally. App code composes entries with the factories
// above and never touches lowering/driver functions directly.
export { CONTRIBUTOR } from "./resolver/contract";
export {
  TOOL_SOURCE,
  TOOL_SOURCE_PROVENANCE,
  TOOL_SOURCE_SESSION_PROVENANCE,
  ToolSourceCollisionError,
  ToolSourceUnsupportedError,
  isToolSource,
  toolSourceProvenance,
  toolSourceSessionProvenance,
  withToolSourceProvenance,
  withToolSourceSessionProvenance,
} from "./tools/tool-source";
export type {
  ToolSource,
  ToolSourceMaterializationContext,
  ToolSourceMaterializer,
  ToolSourceProvenance,
  ToolSourceSessionProvenance,
  ToolSourceSession,
} from "./tools/tool-source";
export type {
  ContributeArgs,
  Contribution as LoweredContribution,
  ContributionFacts,
  GateResult,
  InclusionStep,
  LoweredContributor,
  MergedResolution,
  ResolvedSystemContent,
  SchemaContribution,
} from "./resolver/contract";
export {
  WorkspaceSnapshotError,
  workspace,
  workspaceToolNames,
  retrieverWorkspaceMountSource,
} from "./workspace";
export {
  inMemoryAssetStore,
  inMemoryRecordStore,
  inMemoryStorage,
  inMemoryVectorStore,
  storage,
  StorageError,
} from "./storage";
export type { ContextTreeResult } from "./prompt";
export type {
  Workspace,
  WorkspaceArtifact,
  WorkspaceArtifactsQuery,
  WorkspaceArtifactStatus,
  WorkspaceAppendOptions,
  WorkspaceConfig,
  WorkspaceContent,
  WorkspaceContextOptions,
  WorkspaceChangeEvent,
  WorkspaceChangeType,
  WorkspaceDeleteOptions,
  WorkspaceDirectory,
  WorkspaceEditOptions,
  WorkspaceEditPatch,
  WorkspaceJsonContent,
  WorkspaceFile,
  WorkspaceFinalizeOptions,
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
  WorkspaceGrepResult,
  WorkspaceListEntry,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceLimits,
  WorkspaceCustomMountSource,
  WorkspaceMountGrepOptions,
  WorkspaceMountListOptions,
  WorkspaceMountPathOptions,
  WorkspaceMountReadOptions,
  WorkspaceMountWriteOptions,
  WorkspaceMount,
  WorkspaceMountAccess,
  WorkspaceMountSource,
  WorkspaceMoveOptions,
  WorkspaceNamespaceOption,
  WorkspaceOperation,
  WorkspaceProvenance,
  WorkspaceReadOptions,
  WorkspaceReadResult,
  WorkspacePathChangeEvent,
  WorkspaceRenameChangeEvent,
  WorkspaceRetention,
  WorkspaceToolOptions,
  WorkspaceTools,
  WorkspaceToolNames,
  WorkspaceTransaction,
  WorkspaceTransactionOptions,
  WorkspaceWatchCallback,
  WorkspaceWatchHandle,
  WorkspaceWatchOptions,
  WorkspaceWriteOptions,
  WorkspaceRetrieverMountOperation,
  WorkspaceRetrieverMountQueryInput,
  WorkspaceRetrieverMountSource,
  WorkspaceRetrieverMountSourceOptions,
  WorkspaceSnapshotErrorCode,
  WorkspaceSnapshotListOptions,
  WorkspaceSnapshotOperations,
  WorkspaceSnapshotOptions,
  WorkspaceSnapshotPage,
  WorkspaceSnapshotRef,
  WorkspaceSnapshotRestoreResult,
} from "./workspace";
export type {
  Asset,
  AssetInfo,
  AssetPutOptions,
  AssetRef,
  AssetStore,
  DataAsset,
  ExactFilter,
  JsonObject,
  ProviderFileAsset,
  RecordEntry,
  RecordListOptions,
  RecordPage,
  RecordStore,
  RecordStoreCapabilities,
  RecordWrite,
  RecordWriteOptions,
  StoredAsset,
  Storage,
  StorageErrorCode,
  UrlAsset,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
} from "./storage";
export { createPrompts } from "./prompt";
export type { PromptTree, PromptTreeResult } from "./prompt";
export { tool } from "./tools/define-tool";
export type { NamedToolDef, ToolConfig } from "./tools/types";
export {
  createNoTranscriptError,
  assertAudioMediaType,
  detectAudioMediaType,
  isNoTranscriptError,
  normalizeAudioSource,
  validateTranscribeOptions,
  validateAudioBytes,
  validateTranscriptionResult,
} from "./transcription";
export type {
  AudioSource,
  NativeTranscriptionResult,
  NoTranscriptError,
  Transcribe,
  TranscribeCommonOptions,
  TranscribeOptions,
  TranscriptionResult,
  TranscriptInterval,
} from "./transcription";
export {
  createGenerateSpeechResult,
  validateGenerateSpeechOptions,
} from "./speech";
export type {
  GenerateSpeech,
  GenerateSpeechOptions,
  GenerateSpeechResult,
  SpeechStreamEvent,
  StreamSpeech,
  StreamSpeechOptions,
  StreamSpeechResult,
} from "./speech";
export type { StreamingOperationResult } from "./adapter/streaming-operation";

// Request-scoped deferred work
export { defer, CruxDeferError, DEFER_ERROR_CODES } from "./defer";
export type {
  Awaitable,
  CruxDeferErrorCode,
  DeferredCallback,
  DeferredWorkRef,
  DeferErrorInput,
} from "./defer";

// Configuration + runtime domain (runtime/config/plugin/hook surface)
export { config, configure } from "./runtime";
export type {
  ConfigureOptions,
  CruxConfig,
  Crux,
  CruxDevtoolsConfig,
  CruxExperimentalConfig,
  CruxExperimentalIndexerConfig,
  CruxExperimentalIndexerNativeConfig,
  CruxExperimentalIndexerNativeEngine,
  CruxGenerationConfig,
  CruxHostBinding,
  CruxIndexerConfig,
  CruxIndexerExtensionReference,
  CruxIndexerExtensionTrustMode,
  CruxIndexerExtensionTrustPolicy,
  CruxLintConfig,
  CruxLintRuleConfig,
  CruxLintSelectedProfile,
  CruxObservabilityConfig,
  CruxRuntimeConfig,
  PromptRegistry,
} from "./runtime";

export {
  withSession,
  createSessionId,
  getExecutionContext,
  runWithExecutionContext,
} from "./runtime";
export type { ExecutionContext } from "./runtime";
export { remainingHostDeadlineMs } from "./runtime/api/host-lifecycle";
export type {
  CruxContextStorage,
  CruxHostDeadlineOptions,
  CruxHostLifecycle,
} from "./runtime/api/host-lifecycle";
export {
  flow,
  createFlowId,
  signalFlow,
  cancelFlow,
  listFlows,
  FlowSuspendedError,
  FlowCancelledError,
  FlowExpiredError,
  InvalidSignalPayloadError,
  FlowSerializationError,
  noPayload,
} from "./flow/scope";
export type {
  FlowHandle,
  FlowPersistenceBoundary,
  FlowResumeOptions,
  FlowRunOptions,
  FlowScope,
  FlowSignalOptions,
  FlowUntilIdleOptions,
  FlowWaitForEvent,
  FlowWaitForOptions,
  FlowResult,
  FlowSnapshot,
  FlowSummary,
  ListFlowsOptions,
  SuspendOptions,
  StepOptions,
} from "./flow/scope";
export type {
  FlowDefinitionOptions,
  FlowSignalMap,
  FlowSignalPayload,
  FlowSignalSpec,
  NoPayloadSignal,
} from "./flow";
export { getWork, spawn } from "./work";
export type {
  CancelOptions,
  CancelReceipt,
  DetachReceipt,
  ExecutionStats,
  SpawnWorkOptions,
  WorkEvent,
  WorkHandle,
  WorkProgress,
  WorkStatus,
  WorkStreamOptions,
} from "./work";
export {
  CruxEffectError,
  EFFECT_ERROR_CODES,
  EffectOutcomeUnknownError,
  RollbackError,
  effect,
  reconcileEffect,
  recover,
  rollback,
  rollbackOnError,
} from "./effect";
export type {
  CapturedEffectRecoveryContext,
  CapturedRecoverableEffectOptions,
  CruxEffectErrorCode,
  EffectCallArgs,
  EffectCaptureContext,
  EffectDefinition,
  EffectErrorInput,
  EffectExecutionContext,
  EffectExecutionResult,
  EffectExecutor,
  EffectOptions,
  EffectOutcome,
  EffectOutcomeUnknownDetails,
  EffectReceipt,
  EffectReceiptRef,
  EffectReconciliation,
  EffectRecoveryContext,
  EffectResource,
  EffectScopeLifecycle,
  EffectScopeRef,
  RecoverableEffectDefinition,
  RecoverableEffectOptions,
  ReconcileEffect,
  RecoverOptions,
  RecoveryAvailability,
  RecoveryEnvelope,
  RecoveryUnitLifecycle,
  RecoveryUnitResult,
  RecoveryUnitStatus,
  RollbackBoundaryController,
  RollbackErrorInput,
  RollbackOnErrorOptions,
  RollbackOptions,
  RollbackResult,
} from "./effect";

// Tokenizer
export { setTokenizer, countTokens } from "./shared/tokenizer";

// Plugin system
export { mergeHooks, applyPlugins } from "./runtime";
export type {
  CruxPlugin,
  CruxPluginResult,
  ApplyPluginsResult,
} from "./runtime";

export { toolMiddleware, approvalMiddleware } from "./tools/middleware";
export {
  toolApprovalResponse,
  toolApprovalResponseMessage,
  appendToolApprovalResponse,
  findToolApprovalRequests,
  findToolApprovalDecision,
  deniedToolModelOutput,
} from "./tools/approvals";
export {
  approvalPolicyKind,
  inspectToolApprovalPolicies,
  resolveApprovalPolicy,
} from "./tools/approval-policy";
export type {
  ApprovalDeclaration,
  ResolvedApprovalPolicy,
  ToolApprovalContext,
  ToolApprovalInspection,
  ToolApprovalLayer,
  ToolApprovalMap,
  ToolApprovalPolicy,
} from "./tools/approval-policy";
export type {
  ToolApprovalDecision,
  ToolApprovalDecisionEvent,
  ToolApprovalPolicyIdentity,
  ToolApprovalReplayProvenance,
  ToolApprovalRequest,
  ToolApprovalRequestPart,
  ToolApprovalRequestPayload,
  ToolApprovalResponsePart,
  ToolApprovalStatus,
  ToolCallContext,
  ToolErrorContext,
  ToolExecutionOptions,
  ToolExecuteFunction,
  ToolLike,
  ToolMatcher,
  ToolMiddleware,
  ToolMiddlewareConfig,
  ToolMiddlewareNext,
  ToolResultContext,
  ApprovalMiddlewareConfig,
} from "./tools/types";
export type {
  KnownToolsFor,
  MergeKnownTools,
  PromptToolsOf,
  ToolContextOf,
  ToolsContextOf,
  ToolsContextOption,
} from "./tools/context-types";

// Runtime hooks — prefer `config()` for centralized setup
export {
  getHooks,
  pushHooksLayer,
  setHooks,
  updateHooks,
  resetHooks,
  restoreHooksLayer,
  resolveRecords,
} from "./runtime";
export type {
  CruxHooks,
  HooksLayerToken,
  SpanActivationHook,
  TelemetryFlushHook,
  TelemetryFlushHookOptions,
  TelemetryFlushHookResult,
  TelemetryResumeAttributesHook,
} from "./runtime";
export type { PromptMiddleware, PromptMiddlewareArgs } from "./runtime";

// Canonical observability graph contract.
export * from "./observability";

// Qualified execution evidence.
export * from "./evidence";

// Canonical message type (generation lifecycle domain)
export type { Message, CompactionResult } from "./generation";

// Fallback (generation lifecycle domain)
export {
  fallback,
  isFallback,
  classifyError,
  shouldAttemptFallback,
} from "./generation";
export type {
  FallbackModel,
  FallbackOptions,
  ErrorCategory,
} from "./generation";

// Validation Retry (generation lifecycle domain)
export {
  ValidationExhaustedError,
  isValidationExhaustedError,
} from "./generation";
export type {
  ValidationRetryOptions,
  ValidationExhaustedErrorInit,
} from "./generation";
export { repairJsonText } from "./generation";

// Sanitization
export {
  escapeXml,
  truncate,
  userContent,
  safe,
  raw,
  limit,
  wrap,
  detectSuspiciousPatterns,
} from "./shared/sanitize";
export type { SuspiciousPatternWarning } from "./shared/sanitize";

// Guardrail
export {
  guardrail,
  isGuardrail,
  GuardrailBlockedError,
} from "./safety/guardrail";
export type { Guardrail, GuardrailConfig } from "./safety/guardrail";

// Constraint
export { constraint, isConstraint } from "./safety/constraint";
export { ConstraintViolationError } from "./safety/constraint";
export type {
  Constraint,
  ConstraintConfig,
  ConstraintContext,
  ConstraintSeverity,
  ConstraintCheckResult,
  ConstraintAudit,
} from "./safety/constraint";

// Safety session + plugin (full surface at ./safety)
export {
  createSafety,
  defaultConstraintFeedbackFormatter,
} from "./safety/session";
export type {
  Safety,
  SafetyCallOptions,
  SafetyOutput,
  SafetyStream,
  SafetyProtocolEvent,
} from "./safety/session";
export type { SafetyAudit } from "./safety/audit";
export { createSafetyPlugin } from "./safety/plugin";
export type { SafetyPolicy } from "./safety/plugin";

// Type exports — prompt authoring domain
export type {
  // Context
  Context,
  ContextDef,
  ContextSystemContent,
  ContextSystemArg,
  ContextSystemResult,
  ContextTextSegment,
  ContextEntry,
  ThreadHistoryEntry,
  ThreadTurnCommitInput,
  ConditionalContext,
  MatchCases,
  MatchSpec,
  ContextTree,
  DeepReadonly,
  // Prompt
  Prompt,
  AnyPrompt,
  PromptConfig,
  PromptCallback,
  PromptContent,
  PromptField,
  PromptInputArg,
  SystemField,
  // Input merging
  MergedInput,
  MergeContextInputs,
  Simplify,
  // Hooks
  PromptHooks,
  PrepareHookArgs,
  GenerateHookArgs,
  ErrorHookArgs,
} from "./prompt";

// Type exports — provider-neutral base surface (owned by the root type module)
export type {
  // Base types
  AnyModel,
  AnyToolSet,
  AnyMessage,
  // Model info
  ModelInfo,
  // Project tool catalog
  FlowToolDef,
} from "./types";

// Type exports — prompt resolution + inspection output (resolver domain)
export type {
  ResolvedPrompt,
  ResolveOptions,
  SystemBlock,
  InspectResult,
  InspectPart,
  DroppedContext,
  ExcludedContext,
} from "./resolver/types";

// Type exports — generation lifecycle domain (settings, adaptation, usage)
export type {
  GenerationSettings,
  GenerationMeta,
  GenerateResultMeta,
  HasToolCallStopCondition,
  MaxStepsStopCondition,
  PromptAdaptation,
  ProviderAdaptations,
  StopCondition,
  TokenUsage,
  TraceMeta,
  ToolChoice,
} from "./generation";
export { hasToolCall, maxSteps } from "./generation";
export {
  createGeneratedImageResult,
  isNoImageGeneratedError,
  lowerImagePrompt,
  validateGenerateImageOptions,
} from "./generation";
export type {
  GenerateImage,
  GenerateImageCommonOptions,
  GenerateImageOptions,
  GenerateImageResult,
  GenerateImageResultFields,
  ImageStreamEvent,
  ImagePrompt,
  ImagePromptContent,
  ImagePromptLoweringContext,
  LoweredImagePrompt,
  NativeGeneratedImage,
  NoImageGeneratedError,
  StreamImage,
  StreamImageOptions,
  StreamImageResult,
} from "./generation";
export type {
  CompletedOperationResult,
  OperationExecution,
  OperationTimeout,
} from "./completed-operation";
export type {
  AssistantContentPart,
  ContentPart,
  MediaSource,
  MessageContent,
  ReasoningPart,
  ToolCallPart,
} from "./types/content";
export {
  createInvalidMediaSourceError,
  createMediaMaterializationError,
  createUnsupportedCapabilityError,
  contentText,
  hasMediaParts,
  isInvalidMediaSourceError,
  isMediaMaterializationError,
  isUnsupportedCapabilityError,
  messageText,
  textPart,
} from "./content";
export type {
  InvalidMediaSourceError,
  MediaMaterializationError,
  MediaMaterializationReason,
  UnsupportedCapabilityError,
  UnsupportedCapabilityIssue,
} from "./content";
export type { TokenizerFn } from "./shared/tokenizer";
export { history } from "./request/history/managed";
export type { HistoryFactory } from "./request/history/managed";
export { summarize } from "./request/history/strategies";
export type {
  SummarizeFactory,
  SummarizeStrategy,
} from "./request/history/strategies";
export type {
  HistoryOptions,
  HistoryProjection,
  ManagedHistoryProjection,
  ManagedHistoryRecent,
  ManagedHistorySummaryOptions,
  ProviderHistorySummaryInput,
  ProviderHistorySummaryResult,
  RecentHistoryOptions,
  RecentHistoryProjection,
} from "./request/history/source";
export type {
  GenerateObjectCommonOptions,
  GenerateObjectFn,
  GenerateObjectInput,
  GenerateTextFn,
} from "./generation/support-types";
export {
  droppable,
  offload,
  offloadable,
  prefer,
  summarizable,
} from "./request/representation/wrappers";
export type { OffloadReceipt } from "./request/offload/handle";
export type {
  DroppableLadder,
  ForcedOffload,
  OffloadableLadder,
  OffloadableOptions,
  PreferLadder,
  RepresentationLadder,
  RepresentationEntry,
  RepresentationSource,
  RepresentationSourceSchema,
  SummarizableLadder,
  SummarizableOptions,
  ToolOutputOffloadPolicy,
} from "./request/representation/ladder-types";

// Memory
export {
  memory,
  memoryBlock,
  workingState,
  episodes,
  facts,
  procedures,
  reflections,
} from "./memory";
export type {
  Memory,
  MemoryBudget,
  MemoryBlock,
  MemoryBlockConfig,
  MemoryBlockContext,
  MemoryBlockKind,
  MemoryCaptureConfig,
  MemoryCaptureMode,
  MemoryConfig,
  MemoryEntryApi,
  MemoryEntryRenderStrategy,
  MemoryListRenderStrategy,
  MemoryMessage,
  MemoryNamespace,
  MemoryPolicy,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRenderQuery,
  MemoryRuntimeOptions,
  MemorySemanticRenderStrategy,
  MemoryToolEvent,
  MemoryTurn,
  MemoryWriteMode,
} from "./memory";

// Entity interface
export { composeTools } from "./tools/entity";
export type { CruxEntity, QueryableCruxEntity } from "./tools/entity";

// Retrieval
export {
  communities,
  knowledgeBase,
  retriever,
  retrievalRecipe,
  retrievalStep,
  retrieve,
  grounding as retrievalGrounding,
  RetrievalNotImplementedError,
} from "./retrieval";
export type {
  Grounding as RetrievalGrounding,
  KnowledgeBase,
  KnowledgeBaseConfig,
  KnowledgeBaseInspection,
  KnowledgeBaseScopeConfig,
  CommunitiesConfig,
  CommunitiesFactoryConfig,
  CommunityBuildDescriptor,
  CommunityRefreshHost,
  KnowledgeCommunitiesSurface,
  CommunityReadinessStatus,
  CommunityReportsOptions,
  CommunityReportsPage,
  CommunityReport,
  CommunityReportCounts,
  CommunityReportFinding,
  CommunityReportLineage,
  ScopedKnowledgeBase,
  PlannedQuery,
  RecipeTrace,
  RetrievalModel,
  RetrievalRecipe,
  RetrievalRecipeConfig,
  RetrievalStep,
  RetrievalStepConfig,
  RetrievalStepContext,
  RetrievalStepKind,
  StepInput,
  StepOutput,
  StepPhase,
  Retriever,
  RetrieverHit,
  RetrieverSource,
  RetrieveOptions,
  RetrieverMode,
  RetrievalInjectMode,
  RetrievalToolConfig,
  RetrievalToolName,
} from "./retrieval";

// Citations / grounding
export {
  citationSchema,
  citationConstraint,
  grounding,
  renderCitationContext,
  resolveCitations,
} from "./citations";
export type {
  Citation,
  CitationConstraintConfig,
  CitationIssue,
  CitationIssueCode,
  CitationQuotePolicy,
  CitationResolveOptions,
  CitationValidationArtifact,
  CitationValidationResult,
  CitationValidationSummary,
  Grounding,
  GroundingConfig,
  ResolvedCitation,
} from "./citations";

// Indexing
export { corpus, indexer } from "./indexing";
export type {
  Corpus,
  CorpusConfig,
  CorpusProgressEvent,
  CorpusSourceResult,
  CorpusSyncOptions,
  CorpusSyncResult,
  CruxDocument,
  CruxChunk,
  CruxSourceFacts,
  ChunkingOptions,
  Chunker,
  ChunkTransform,
  IndexDryRunResult,
  IndexFingerprintOptions,
  IndexResult,
  Indexer,
  SourceRecord,
  SourceStatus,
} from "./indexing";

// Semantic response cache (prompt-level cache intent)
export type {
  SemanticCacheMode,
  SemanticCachePromptOptions,
  PromptCacheOptions,
  SemanticCacheQueryContext,
} from "./prompt";

// Cost tracking
export { CostLimitError, modelPricing, withCostTracking } from "./cost";
export type {
  CostBreakdown,
  CostBudgetEvent,
  CostEntry,
  CostReport,
  CostReportEvent,
  CostSource,
  CostTracker,
  CostTrackingBudget,
  CostTrackingOptions,
  ModelPrice,
  ModelPricing,
} from "./cost";

// Plan & Tasks primitives
export { plan } from "./plan/plans";
export { tasks } from "./plan/tasks";
export { task } from "./plan/task-spec";
export {
  DuplicateTaskIdError,
  InvalidTaskTransitionError,
  TaskJsonValueError,
  TaskListDiscardedError,
  TaskListNotFoundError,
  TaskNotFoundError,
  TaskRemovedError,
  TaskResultValidationError,
} from "./plan/errors";
export { deriveTaskListStatus } from "./plan/helpers";
export {
  CreationToolNotCreatedError,
  isCreationToolNotCreatedError,
} from "./types/tool";
export type {
  ToolDef,
  CreationTool,
  CreationToolNotCreatedError as CreationToolNotCreatedErrorType,
} from "./types/tool";
export type { PlanFactory, PlanListOptions } from "./plan/plans";
export type { TaskListListOptions, TasksFactory } from "./plan/tasks";
export type { PlanToolOptions, TasksToolOptions } from "./plan/creation-tools";
export type {
  TaskLifecycleError,
  TaskLifecycleErrorDetails,
  TaskLifecycleErrorName,
} from "./plan/errors";
export type {
  AddTaskInput,
  CancellableTaskStatus,
  Plan,
  PlanHandle,
  PlanUpdate,
  CreatePlanInput,
  Task,
  TaskEdit,
  TaskList,
  TaskListStatus,
  TaskListHandle,
  TaskSpec,
  TaskSpecOptions,
  TaskStatus,
  TasksHandle,
  TasksInput,
  TerminalTaskStatus,
} from "./plan/types";

// Adapter internals — used by @use-crux/ai, @use-crux/openai, @use-crux/google, @use-crux/convex
/** @internal */ export {
  orchestrateGenerate,
  orchestrateStream,
  wrapStreamIterable,
  TimeoutError,
  normalizeBudgetMs,
  toolBudgetMs,
  createBudgetSignal,
  withBudget,
} from "./generation";
/** @internal */ export type {
  TimeoutBudget,
  TimeoutOptions,
  TimeoutErrorOptions,
  BudgetOptions,
  BudgetSignal,
  OrchestrationSpec,
  TextDeltaExtractor,
} from "./generation";

// Provider adapter abstraction (also available as @use-crux/core/adapter subpath)
export { adapter } from "./adapter/define-adapter";
export type {
  AdapterSpec,
  ModelCapacityProfile,
  ModelCapacityResolver,
  ModelCountingConfidence,
  AdapterResponse,
  CallArgs,
  StreamHandle,
  ToolResultEntry,
  StatusDelta,
  CruxAdapter,
  AdapterGenerateOptions,
  AdapterStreamOptions,
  AdapterGenerateResult,
  FinalStepInfo,
  GenerateResult,
  StreamCompletion,
  StreamCompletionPayload,
  StreamResult,
} from "./adapter/index";
// Value exports come from the source module: a value re-export through the
// adapter barrel would pull its testing helpers (and vitest) into
// platform-neutral runtime bundles.
export {
  CONSERVATIVE_MODEL_CAPACITY,
  resolveModelCapacityProfile,
} from "./request/capacity/model-profile";
export { RequestCompositionError } from "./request/errors";
export { mergeInputBudget } from "./request/budget/input-budget";
export { PreparationError } from "./request/prepare/step";
export { ResourceReadError } from "./request/prepare/resources";
export type { InputBudget } from "./request/budget/input-budget";
export type {
  PreparationErrorReason,
  PrepareStep,
} from "./request/prepare/step";
export type {
  ControlReadable,
  PreparationResources,
  ResourceReadErrorReason,
} from "./request/prepare/resources";
export type {
  AmendableContextEntry,
  ContributorSelector,
  ExecutionAmendment,
  OperationKind,
} from "./request/prepare/amendment";
export type {
  ConsensusInvocationContext,
  InvocationContext,
  InvocationPreparationStats,
  InvocationTarget,
  ParallelInvocationContext,
  PipelineInvocationContext,
  PrepareInvocation,
  SwarmInvocationContext,
} from "./request/prepare/invocation";
export type {
  PreparationAttemptStats,
  PreparationCoverage,
  PreparationModelCallStats,
  PreparationScopeStats,
  PreparationUsageStats,
  StepContext,
  StepPreparationStats,
  StepReason,
  StepToolHistoryEntry,
} from "./request/prepare/step-context";
export type { PreparationDecisionInspection } from "./request/prepare/journal";
export { preview } from "./request/preview/preview";
export type { RequestPreviewTarget } from "./request/preview/preview";
export type {
  PreviewAdaptation,
  PreviewAdaptationState,
  RequestPreview,
  RequestPreviewOptions,
} from "./request/preview/types";
export type {
  RequestCompositionErrorCode,
  RequestDiagnostic,
} from "./request/errors";
export type {
  RequestAdaptation,
  RequestWarning,
} from "./request/receipt/adaptations";
export type {
  RequestInspection,
  RequestReceipt,
} from "./request/receipt/receipt";
export {
  inspectRequest,
  RequestInspectionUnavailableError,
} from "./request/receipt/inspection";
export type {
  RequestArtifactInspection,
  RequestCandidateInspection,
  RequestContributionInspection,
  RequestSupportReceipt,
} from "./request/receipt/inspection";
export type {
  CompositionRequestReceiptNode,
  CompositionRequestReceiptTree,
  InvocationRequestReceiptNode,
  NestedRequestReceiptNode,
  ReceiptCompositionKind,
} from "./request/receipt/tree";
export type {
  RequestTokenBreakdown,
  RequestTokenBreakdownEntry,
} from "./request/measure/breakdown";

// Loop-owning adapter abstraction (also available as @use-crux/core/adapter subpath)
export { loopRuntimeAdapter } from "./adapter/define-executor";
export type {
  LoopRuntimePort,
  BoundLoopRuntime,
  CachedStreamPayload,
  ExecutorRequest,
  ExecutorRequestStepInput,
  ExecutorRequestStepPlanner,
  SealedExecutorRequestStep,
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
  CruxExecutor,
  ExecutorModelArg,
  ExecutorGenerateOptions,
  ExecutorStreamOptions,
  ExecutorGenerateResult,
  ApprovalRequestInfo,
} from "./adapter/index";

export type {
  JsonPrimitive,
  JsonValue,
  ProviderOptions,
  ToolModelOutput,
  ToModelOutputArgs,
} from "./types/tool";
