/**
 * `@use-crux/core` — SDK-agnostic prompt composition and context engineering.
 *
 * Provides composable, portable prompt abstractions that work with any AI SDK.
 * Compose prompts once, execute with any adapter.
 *
 * **Core API:**
 * - `prompt()` — Compose typed, SDK-agnostic prompts with contexts and schemas
 * - `context()` — Create reusable typed fragments that contribute to system messages
 * - `createPrompts()` — Organize prompts into a nested tree with IDE autocomplete
 * - `createContexts()` — Organize contexts into a nested tree with IDE autocomplete
 * - `config()` — Single entry point for configuration (devtools, middleware, evals, etc.)
 *
 * **Resolution & Inspection:**
 * - `.resolve()` — Get SDK-agnostic resolved prompt data (system, prompt, schema, tools)
 * - `.inspect()` — See per-part token breakdown and what was dropped
 *
 * **Adapter packages (execution):**
 * - `@use-crux/ai` — Vercel AI SDK adapter (`generate()`, `stream()`)
 * - `@use-crux/openai` — OpenAI SDK adapter (`createOpenAI()`)
 * - `@use-crux/google` — Google GenAI adapter (`createGoogle()`)
 *
 * **Other subpaths:**
 * - `@use-crux/core/quality` — `quality()`, `suite()`, and `target()` for local quality loops
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
  workspace,
  memoryWorkspaceBlobStore,
  workspaceToolNames,
  retrieverWorkspaceMountSource,
} from "./workspace";
export {
  inMemoryBlobStore,
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
  WorkspaceBlobReadResult,
  WorkspaceBlobRef,
  WorkspaceBlobStore,
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
} from "./workspace";
export type {
  BlobReadResult,
  BlobRef,
  BlobStore,
  ExactFilter,
  JsonObject,
  RecordEntry,
  RecordListOptions,
  RecordPage,
  RecordStore,
  RecordStoreCapabilities,
  RecordWrite,
  RecordWriteOptions,
  Storage,
  StorageErrorCode,
  VectorHit,
  VectorRecord,
  VectorSearchQuery,
  VectorStore,
} from "./storage";
export { createPrompts } from "./prompt";
export type { PromptTree, PromptTreeResult } from "./prompt";
export { tool } from "./tools/define-tool";
export type { NamedToolDef, ToolConfig } from "./tools/types";

// Request-scoped deferred work
export { defer, CruxDeferError, DEFER_ERROR_CODES } from "./defer";
export type {
  Awaitable,
  CruxDeferErrorCode,
  DeferredCallback,
  DeferErrorInput,
} from "./defer";

// Configuration + runtime domain (runtime/config/plugin/hook surface)
export { config } from "./runtime";
export type {
  CruxConfig,
  Crux,
  CruxDevtoolsConfig,
  CruxExperimentalConfig,
  CruxExperimentalIndexerConfig,
  CruxExperimentalIndexerNativeAstConfig,
  CruxExperimentalIndexerNativeConfig,
  CruxExperimentalIndexerNativeEngine,
  CruxGenerationConfig,
  CruxIndexerConfig,
  CruxIndexerExtensionReference,
  CruxIndexerExtensionTrustMode,
  CruxIndexerExtensionTrustPolicy,
  CruxLintConfig,
  CruxLintRuleConfig,
  CruxLintSelectedProfile,
  CruxObservabilityConfig,
  CruxPersistenceConfig,
  CruxRuntimeConfig,
} from "./runtime";
export type { QualityConfig } from "./quality/config";
export type { PromptRegistry } from "./runtime";

export {
  withSession,
  createSessionId,
  getExecutionContext,
  runWithExecutionContext,
} from "./runtime";
export type { ExecutionContext } from "./runtime";
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
export type { CruxHooks, HooksLayerToken } from "./runtime";
export type { PromptMiddleware, PromptMiddlewareArgs } from "./runtime";

// Canonical observability graph contract.
export * from "./observability";

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
} from "./shared/sanitize";
export type { SuspiciousPatternWarning } from "./shared/sanitize";

// Guardrail
export {
  guardrail,
  isGuardrail,
  GuardrailBlockedError,
} from "./safety/guardrail";
export type {
  Guardrail,
  GuardrailConfig,
} from "./safety/guardrail";

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
export type { ContentPart, MessageContent } from "./types/content";
export {
  UnsupportedContentError,
  contentText,
  filePart,
  hasMediaParts,
  imagePart,
  messageText,
  textPart,
} from "./content";
export type {
  FilePartInput,
  ImagePartInput,
  UnsupportedContentErrorOptions,
} from "./content";
export type { TokenizerFn } from "./shared/tokenizer";

// Memory
export {
  memory,
  memoryBlock,
  recentMessages,
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
/** @internal */ export { sanitizeJsonSchema } from "./shared/schema-compat";
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
  StreamResult,
} from "./adapter/index";

// Loop-owning adapter abstraction (also available as @use-crux/core/adapter subpath)
export { loopRuntimeAdapter } from "./adapter/define-executor";
export type {
  LoopRuntimePort,
  BoundLoopRuntime,
  CachedStreamPayload,
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
