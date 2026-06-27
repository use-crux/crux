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

// Core definition API
export { prompt } from './define'
export { context, createContexts, when, match } from './context'
export { injectable } from './injectable'
export { contributor, isContributorEntry } from './contributor'
export type { ContributorConfig } from './contributor'
export type { ContributorContribution, ContributorEntry } from './types'
export { compilePrompt } from './resolve'
export type { CompiledPrompt, CompilePromptOptions, PromptResolution, Resolution, ResolveCallOptions } from './resolve'
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
} from './resolver/fakes'
export type {
  RecordedArtifact,
  RecordingObservability,
  InMemorySkillSource,
  FixedClock,
  InMemoryContextCache,
  CollectingDiagnostics,
  RecordingInstrumentation,
} from './resolver/fakes'
// Test helper: a conformant in-memory `AgentExecutor` for composition tests
// (the agent-layer analogue of the resolver fakes above).
export { createFakeAgentExecutor } from './agent/fakes'
export type {
  FakeAgentExecutor,
  FakeAgentExecutorConfig,
  FakeAgentBehavior,
  FakeAgentBehaviorResolver,
  FakeAgentInvocation,
  FakeAgentUsage,
} from './agent/fakes'
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
} from './resolver/ports'
// The contributor contract types — the lowered form every `use:` entry
// resolves through internally. App code composes entries with the factories
// above and never touches lowering/driver functions directly.
export { CONTRIBUTOR } from './resolver/contract'
export type {
  ContributeArgs,
  Contribution,
  ContributionFacts,
  GateResult,
  InclusionStep,
  LoweredContributor,
  MergedResolution,
  ResolvedSystemContent,
  SchemaContribution,
} from './resolver/contract'
export { workspace, memoryWorkspaceBlobStore, workspaceToolNames } from './workspace'
export { inMemoryBlobStore, inMemoryDataStore, inMemoryStorage, inMemoryVectorStore, storage } from './storage'
export type { ContextTreeResult } from './context'
export type {
  Workspace,
  WorkspaceBlobReadResult,
  WorkspaceBlobRef,
  WorkspaceBlobStore,
  WorkspaceConfig,
  WorkspaceContent,
  WorkspaceFile,
  WorkspaceListEntry,
  WorkspaceListResult,
  WorkspaceMount,
  WorkspaceMountAccess,
  WorkspaceReadResult,
  WorkspaceToolNames,
} from './workspace'
export type {
  BlobReadResult,
  BlobRef,
  BlobStore,
  DataStore,
  Storage,
  VectorHit,
  VectorRecord,
  VectorStore,
} from './storage'
export { createPrompts } from './prompts-tree'
export type { PromptTree, PromptTreeResult } from './prompts-tree'
export { tool } from './tools'
export type { NamedToolDef, ToolConfig } from './tools'

// Configuration
export { config } from './config'
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
} from './config'
export type { QualityConfig } from './quality/config'
export type { PromptRegistry } from './configure'

export { withSession, createSessionId, getExecutionContext, runWithExecutionContext } from './execution-context'
export type { ExecutionContext } from './execution-context'
export {
  flow,
  createFlowId,
  signalFlow,
  cancelFlow,
  listFlows,
  FlowSuspendedError,
  FlowCancelledError,
  FlowExpiredError,
} from './flow/scope'
export type {
  FlowHandle,
  FlowRunOptions,
  FlowScope,
  FlowResult,
  FlowSnapshot,
  FlowSummary,
  ListFlowsOptions,
  SuspendOptions,
  StepOptions,
  WithFlowOptions,
} from './flow/scope'

// Tokenizer
export { setTokenizer, countTokens } from './tokenizer'

// Plugin system
export { mergeRuntime, applyPlugins } from './plugin'
export type { CruxPlugin, CruxPluginResult, ApplyPluginsResult } from './plugin'

// Hook types — needed by plugin authors
export type { InstrumentationHooks } from './middleware'
export {
  toolMiddleware,
  approvalMiddleware,
  toolApprovalResponse,
  toolApprovalResponseMessage,
  appendToolApprovalResponse,
  findToolApprovalRequests,
  findToolApprovalDecision,
  deniedToolModelOutput,
} from './tool-middleware'
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
} from './tool-middleware'

// Runtime hooks — prefer `config()` for centralized setup
export { getRuntime, setRuntime, updateRuntime, resetRuntime, resolveStore } from './runtime'
export type { CruxRuntime } from './runtime'

// Canonical observability graph contract.
export * from './observability'

// Canonical message type
export type { Message, CompactionResult } from './messages'

// Fallback
export { fallback, isFallback, classifyError, shouldAttemptFallback } from './fallback'
export type { FallbackModel, FallbackOptions, FallbackMeta, FallbackAttemptDetail, ErrorCategory } from './fallback'

// Validation Retry
export { ValidationExhaustedError, isValidationExhaustedError } from './validation-retry'
export type { ValidationRetryOptions, ValidationExhaustedErrorInit } from './validation-retry'
export { repairJsonText } from './repair-json'

// Sanitization
export { escapeXml, truncate, userContent, safe, raw, limit, wrap } from './sanitize'
export type { SuspiciousPatternWarning } from './sanitize'

// Guardrail
export { guardrail, isGuardrail, GuardrailBlockedError } from './safety/guardrail'
export type { Guardrail, GuardrailConfig, GuardrailContext, GuardrailPhase } from './safety/guardrail'

// Constraint
export { constraint, isConstraint } from './safety/constraint'
export { ConstraintViolationError } from './safety/constraint'
export type {
  Constraint,
  ConstraintConfig,
  ConstraintContext,
  ConstraintSeverity,
  ConstraintCheckResult,
  ConstraintAudit,
} from './safety/constraint'

// Safety session + plugin (full surface at ./safety)
export { createSafety, defaultConstraintFeedbackFormatter } from './safety/session'
export type { Safety, SafetyCallOptions, SafetyOutput, SafetyStream, SafetyProtocolEvent } from './safety/session'
export { createSafetyPlugin } from './safety/plugin'
export type { SafetyPolicy } from './safety/plugin'

// Type exports
export type {
  // Base types
  AnyModel,
  AnyToolSet,
  AnyMessage,
  PromptInjection,
  InjectableEntry,
  // Context
  Context,
  ContextDef,
  ContextSystemContent,
  ContextSystemArg,
  ContextSystemResult,
  ContextTextSegment,
  ContextEntry,
  ConditionalContext,
  MatchSpec,
  ContextTree,
  DeepReadonly,
  // Prompt
  Prompt,
  AnyPrompt,
  PromptConfig,
  PromptInputArg,
  // Resolution
  ResolvedPrompt,
  ResolveOptions,
  SystemBlock,
  // Settings & adaptation
  GenerationSettings,
  PromptAdaptation,
  AdapterMap,
  // Input merging
  MergedInput,
  MergeContextInputs,
  Simplify,
  // Hooks & middleware
  PromptHooks,
  PrepareHookArgs,
  GenerateHookArgs,
  ErrorHookArgs,
  PromptMiddlewareArgs,
  PromptMiddleware,
  // Inspection
  InspectResult,
  InspectPart,
  DroppedContext,
  ExcludedContext,
  // Model info
  ModelInfo,
  TokenUsage,
  TraceMeta,
  // Project tool catalog
  FlowToolDef,
} from './types'
export type { TokenizerFn } from './tokenizer'

// Store
export { inMemoryCruxStore } from './store/memory'
export type {
  CruxStore,
  JsonObject,
  StoreEntry,
  ListOptions,
  ListResult,
  ScoredEntry,
  SparseVector,
  VectorSearchOptions,
  VectorSearchQuery,
  CruxStoreCapabilities,
  StoreEvent,
  StoreSetEvent,
  StoreDeleteEvent,
} from './store/types'

// Memory
export { memory, memoryBlock, recentMessages, workingState, episodes, facts, procedures, reflections } from './memory'
export type {
  Memory,
  MemoryBlock,
  MemoryBlockConfig,
  MemoryBlockContext,
  MemoryBlockKind,
  MemoryConfig,
  MemoryEntryApi,
  MemoryMessage,
  MemoryNamespace,
  MemoryPolicy,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRuntimeOptions,
  MemoryToolEvent,
  MemoryTurn,
  MemoryWriteMode,
} from './memory'

// Entity interface
export { composeTools } from './entity'
export type { CruxEntity, QueryableCruxEntity } from './entity'

// Retrieval
export {
  retriever,
  reranker,
  retrievalPipeline,
  retrievalStage,
  queryPlanner,
  multiQuery,
  parentExpand,
  compress,
  diversify,
  decay,
} from './retrieval'
export type {
  Retriever,
  RetrieverHit,
  RetrieveOptions,
  RetrieverMode,
  RetrievalInjectMode,
  RetrievalToolConfig,
  RetrievalToolName,
  RetrieverReranker,
  RerankerInput,
  RetrievalPipeline,
  RetrievalPipelineStage,
  RetrievalPipelineTrace,
  RetrievalStageTrace,
  PlannedRetrievalQuery,
} from './retrieval'

// Citations / grounding
export { citationSchema, citationConstraint, grounding, renderCitationContext, resolveCitations } from './citations'
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
} from './citations'

// Indexing
export { corpus, indexer } from './indexing'
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
} from './indexing'

// Semantic response cache
export type {
  SemanticCacheMode,
  SemanticCachePromptOptions,
  PromptCacheOptions,
  SemanticCacheQueryContext,
} from './types'

// Cost tracking
export { CostLimitError, modelPricing, withCostTracking } from './cost'
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
} from './cost'

// Plan & TaskList primitives
export { plan, getPlan, updatePlan } from './plan/plans'
export { tasklist, getTaskList, getTaskListByPlan } from './plan/tasks'
export { deriveTaskListStatus } from './plan/helpers'
export { planAgent, taskListAgent, taskWorker, createPlanTool, createTaskListTool } from './plan/agent'
export type { ToolDef, CreationTool, PlanAgent, PlanAgentOptions, PlanContextMode } from './plan/agent'
export type { TaskListAgent, TaskListAgentOptions } from './plan/agent'
export type { TaskWorker, TaskWorkerOptions } from './plan/agent'
export { createPlanHandle } from './plan/plans'
export type {
  Plan,
  PlanHandle,
  PlanUpdate,
  CreatePlanInput,
  TaskList,
  TaskListStatus,
  TaskListHandle,
  CreateTaskListInput,
  Task,
  TaskStatus,
  TaskUpdate,
  CreateTaskInput,
  TerminalTaskStatus,
  CancellableTaskStatus,
} from './plan/types'

// Adapter internals — used by @use-crux/ai, @use-crux/openai, @use-crux/google, @use-crux/convex
/** @internal */ export { sanitizeJsonSchema } from './schema-compat'
/** @internal */ export {
  orchestrateGenerate,
  orchestrateStream,
  executeFallbackLoop,
  withAttemptTimeout,
  wrapStreamIterable,
} from './orchestrate'
/** @internal */ export type { OrchestrationSpec, TextDeltaExtractor } from './orchestrate'

// Provider adapter abstraction (also available as @use-crux/core/adapter subpath)
export { adapter } from './adapter/define-adapter'
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
} from './adapter/index'

// Loop-owning adapter abstraction (also available as @use-crux/core/adapter subpath)
export { executorAdapter } from './adapter/define-executor'
export type {
  ExecutorSpec,
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
} from './adapter/index'

export type {
  JsonPrimitive,
  JsonValue,
  ProviderOptions,
  ToolContentPart,
  ToolModelOutput,
  ToModelOutputArgs,
} from './types/tool'
