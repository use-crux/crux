/**
 * Devtools catalog/state-plane contract.
 *
 * The catalog describes authored things that exist (prompts, contexts, tools).
 * It is registered separately from execution observability records because it
 * is not something that happened during a run.
 *
 * @module
 */

import { z } from 'zod'

/** JSON Schema representation of a Zod schema. */
export type JsonSchema = Record<string, unknown>

export interface SourceLocation {
  file: string
  line: number
  column?: number
  function?: string
}

export interface SourceRange {
  file: string
  startLine: number
  endLine?: number
  startColumn?: number
  endColumn?: number
}

export interface SourceSnippet {
  source: string
  language?: string
  range: SourceRange
  truncated?: boolean
}

export type DefinitionFidelity = 'resolved' | 'partial' | 'error'

export type ProjectSourceRefRole =
  | 'schema'
  | 'callback'
  | 'handler'
  | 'execute'
  | 'prompt'
  | 'system'
  | 'resolver'
  | 'validator'
  | 'policy'
  | 'config'
  | 'helper'

export interface ProjectSourceRef {
  id: string
  role: ProjectSourceRefRole
  property?: string
  symbol?: string
  source: SourceLocation
  snippet?: SourceSnippet
  fidelity: 'resolved' | 'partial'
  description?: string
  metadata?: {
    schemaKind?: 'zod' | 'convex-validator' | 'json-schema'
    parsedSchema?: boolean
    referencedDefinitionIds?: string[]
    dataAccess?: boolean
    injected?: boolean
    nested?: boolean
    fragment?: boolean
    factoryArg?: boolean
    argumentIndex?: number
    argumentName?: string
    toolMapContributor?: 'spread' | 'property'
    routingTarget?: boolean
    extensions?: Record<string, unknown>
  }
}

export type PrimitiveIntelligenceConfidence = 'static' | 'resolved' | 'semantic' | 'runtime' | 'partial'

export interface PrimitiveSuspensionPoint {
  id: string
  label: string
  signal?: string
  source?: SourceLocation
  resumesDefinitionId?: string
}

export interface SourceRefSummary {
  id?: string
  role?: ProjectSourceRefRole
  property?: string
  symbol?: string
  source?: SourceLocation
  fidelity?: ProjectSourceRef['fidelity']
  description?: string
}

export interface ContractFacts {
  argsSchema?: JsonSchema
  inputSchema?: JsonSchema
  expandedInputSchema?: JsonSchema
  outputSchema?: JsonSchema
  configSchema?: JsonSchema
  schemaRefs?: SourceRefSummary[]
  inputContributions?: InputSchemaContribution[]
  nestedSchemas?: Array<{
    name: string
    schema?: JsonSchema
    source?: SourceLocation
    role: 'input' | 'output' | 'args' | 'config' | 'field'
  }>
  requiredFields?: string[]
  optionalFields?: string[]
  enumFields?: Array<{ field: string; values: string[] }>
}

export interface InputSchemaContribution {
  field: string
  schema?: JsonSchema
  description?: string
  required?: boolean
  sourceDefinitionId?: string
  sourceName?: string
  sourceKind?: ProjectDefinitionKind
  path?: string[]
  via?: InjectionUseFacts['via']
  conditionality?: InjectionUseFacts['conditionality']
  branch?: string
}

export interface ControlFacts {
  mode?:
    | 'sequential'
    | 'parallel'
    | 'fanout'
    | 'consensus'
    | 'swarm'
    | 'durable'
    | 'immediate'
    | 'routing'
    | 'cascade'
    | 'fallback'
    | 'event-driven'
  ordering?: 'ordered' | 'concurrent' | 'event-driven' | 'conditional' | 'unknown'
  children?: string[]
  retryPolicy?: {
    maxAttempts?: number
    backoff?: string
    nonRetryableErrors?: string[]
    [key: string]: unknown
  }
  fallbackPolicy?: {
    optionCount?: number
    timeoutMs?: number
    shouldFallback?: boolean | 'callback'
    [key: string]: unknown
  }
  suspensionPoints?: PrimitiveSuspensionPoint[]
  budget?: {
    maxDurationMs?: number
    maxTokens?: number
    maxCostUsd?: number
    [key: string]: unknown
  }
}

export interface DataAccessFact {
  targetId?: string
  targetVariable?: string
  targetKind?: 'memory' | 'blackboard' | 'workspace' | 'store' | 'block'
  key?: string
  operation?: 'read' | 'write' | 'append' | 'update' | 'delete' | 'query'
  source?: SourceLocation
}

export interface ArtifactFact {
  name: string
  kind?: 'text' | 'json' | 'file' | 'plan' | 'score' | 'citation' | string
  source?: SourceLocation
}

export interface RetrievalFact {
  retrieverId?: string
  memoryId?: string
  workspaceId?: string
  querySource?: SourceLocation
  topK?: number
}

export interface DataFacts {
  reads?: DataAccessFact[]
  writes?: DataAccessFact[]
  artifacts?: ArtifactFact[]
  retrievals?: RetrievalFact[]
}

export interface DependencyFacts {
  prompts?: string[]
  contexts?: string[]
  injectables?: string[]
  tools?: string[]
  agents?: string[]
  flows?: string[]
  memory?: string[]
  blackboards?: string[]
  workspaces?: string[]
  stores?: string[]
  blocks?: string[]
  routers?: string[]
  ragPipelines?: string[]
  retrievers?: string[]
  guardrails?: string[]
  constraints?: string[]
  scorers?: string[]
  extensions?: Record<string, unknown>
}

export interface RuntimeFacts {
  join?: ProjectRuntimeJoin
  expectedPrimitive?: string
  expectedSpanName?: string
  correlationAttributes?: string[]
  spanAttributes?: Record<string, string>
  extensions?: Record<string, unknown>
}

export interface IntelligenceDiagnostic {
  code: string
  message: string
  severity?: 'info' | 'warning' | 'error'
  source?: SourceLocation
  data?: Record<string, unknown>
}

export interface ProjectRuntimeJoin {
  definitionId: string
  kind: ProjectDefinitionKind
  name: string
  primitive?: string
  spanName?: string
  flowName?: string
  stepLabel?: string
  parentDefinitionId?: string
  sourceDefinitionId?: string
  blockDefinitionId?: string
  blockId?: string
  blockKind?: string
  correlationAttributes?: string[]
  spanAttributes?: Record<string, string>
  backend?: string
  resource?: string
  runtimeIdPrefix?: string
  promptId?: string
  contextId?: string
  agentId?: string
  toolName?: string
  retrieverId?: string
  memoryId?: string
  memoryStoreId?: string
  ragPipelineId?: string
  workspaceId?: string
  routingId?: string
  routeKey?: string
  extensions?: Record<string, unknown>
  [key: string]: unknown
}

export type ProjectDefinitionCatalogPresentationRole =
  | 'step'
  | 'branch'
  | 'stage'
  | 'route'
  | 'tier'
  | 'option'
  | 'block'
  | 'store'
  | 'case'

export interface ProjectDefinitionCatalogPresentation {
  standalone: boolean
  parentDefinitionId?: string
  parentRelationType?: string
  role?: ProjectDefinitionCatalogPresentationRole
  order?: number
}

export interface PrimitiveIntelligence {
  confidence: PrimitiveIntelligenceConfidence
  contract?: ContractFacts
  control?: ControlFacts
  data?: DataFacts
  dependencies?: DependencyFacts
  runtime?: RuntimeFacts
  diagnostics?: IntelligenceDiagnostic[]
  runtimeJoin?: ProjectRuntimeJoin
  extensions?: Record<string, unknown>
}

export interface ProjectDefinitionMetadata extends Record<string, unknown> {
  argsSchema?: JsonSchema
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  configSchema?: JsonSchema
  schema?: JsonSchema
  catalogPresentation?: ProjectDefinitionCatalogPresentation
  facts?: ProjectDefinitionFacts
  configuration?: Record<string, unknown>
  settings?: Record<string, unknown>
  intelligence?: PrimitiveIntelligence
  runtimeJoin?: ProjectRuntimeJoin
  sourceStatus?: {
    importSafe?: boolean
    partialReason?: string
    confidence?: PrimitiveIntelligenceConfidence
  }
  updated?: {
    lastEditedAt?: string
    lastEditedAtMs?: number
    sourceMtime?: boolean
  }
  extensions?: Record<string, unknown>
}

export type ProjectDefinitionKind =
  | 'prompt'
  | 'context'
  | 'injectable'
  | 'tool'
  | 'agent'
  | 'flow'
  | 'flow.step'
  | 'composition.parallel'
  | 'composition.parallel.branch'
  | 'composition.pipeline'
  | 'composition.pipeline.stage'
  | 'composition.swarm'
  | 'composition.consensus'
  | 'routing.router'
  | 'routing.router.route'
  | 'routing.cascade'
  | 'routing.cascade.tier'
  | 'routing.fallback'
  | 'routing.fallback.option'
  | 'rag.pipeline'
  | 'rag.pipeline.stage'
  | 'rag.retriever'
  | 'memory'
  | 'memory.store'
  | 'memory.block'
  | 'blackboard'
  | 'workspace'
  | 'constraint'
  | 'guardrail'
  | 'scorer'
  | 'dataset'
  | 'suite'
  | 'suite.case'
  | 'eval.prompt'
  | 'eval.flow'
  | 'eval.rag'
  | 'eval.quality'
  | 'unknown'

export interface PromptFacts {
  kind: 'prompt'
  use?: string[]
  useEntries?: InjectionUseFacts[]
  tools?: InjectionToolFacts
  hasSystem?: boolean
  hasPrompt?: boolean
  hasMessages?: boolean
  settings?: Record<string, unknown>
  fragments?: SourceRefSummary[]
}

export interface ContextFacts {
  kind: 'context'
  use?: string[]
  useEntries?: InjectionUseFacts[]
  isStatic?: boolean
  priority?: number
  cache?: Record<string, unknown>
  tools?: InjectionToolFacts
  fragments?: SourceRefSummary[]
}

export interface InjectableFacts {
  kind: 'injectable'
  injectableId?: string
  inputKeys?: string[]
  mayInject?: Array<'contexts' | 'tools' | 'constraints' | 'guardrails' | 'metadata'>
  useEntries?: InjectionUseFacts[]
  tools?: InjectionToolFacts
}

export interface InjectionUseFacts {
  variable?: string
  relationHint?: 'context' | 'injectable' | 'memory' | 'blackboard' | 'unknown'
  targetDefinitionId?: string
  targetKind?: ProjectDefinitionKind
  targetName?: string
  relationType?: string
  relationFidelity?: ProjectRelationFidelity
  conditionality?: 'always' | 'when' | 'match-case' | 'match-default' | 'binary-guard' | 'dynamic' | 'unknown'
  branch?: string
  via?: 'direct' | 'array-ref' | 'spread' | 'when' | 'match' | 'binary' | 'runtime'
}

export interface InjectionToolFacts {
  hasTools: boolean
  dynamic?: boolean
  names?: string[]
  variables?: string[]
}

export interface ToolFacts {
  kind: 'tool'
  toolName?: string
  hasExecute?: boolean
  hasToModelOutput?: boolean
  approvalRequired?: boolean
}

export interface AgentFacts {
  kind: 'agent'
  promptId?: string
  toolNames?: string[]
  handoffs?: string[]
  contextHandler?: SourceRefSummary
  usageHandler?: SourceRefSummary
  prepareHandler?: SourceRefSummary
}

export interface FlowFacts {
  kind: 'flow'
  stepNames?: string[]
  hasArgs?: boolean
  runtime?: 'node' | 'convex'
}

export interface FlowStepFacts {
  kind: 'flow.step'
  flowId: string
  stepId?: string
  stepLabel?: string
  targetDefinitionId?: string
  targetKind?: ProjectDefinitionKind
}

export interface CompositionFacts {
  kind: 'composition.parallel' | 'composition.pipeline' | 'composition.swarm' | 'composition.consensus'
  participants?: string[]
  coordinator?: string
  judge?: string
  scorer?: string
  sharedMemory?: string | string[]
  sharedBlackboard?: string
}

export interface CompositionChildFacts {
  kind: 'composition.parallel.branch' | 'composition.pipeline.stage'
  compositionId: string
  index?: number
  branchId?: string
  stageId?: string
  targetVariable?: string
  targetDefinitionId?: string
  targetKind?: ProjectDefinitionKind
}

export interface RoutingFacts {
  kind: 'routing.router' | 'routing.cascade' | 'routing.fallback'
  routingId?: string
  hasStableId?: boolean
  routeKeys?: string[]
  routeCount?: number
  hasDefaultRoute?: boolean
  hasClassify?: boolean
  tierCount?: number
  optionCount?: number
  hasBudget?: boolean
  budget?: Record<string, unknown>
}

export interface RoutingChildFacts {
  kind: 'routing.router.route' | 'routing.cascade.tier' | 'routing.fallback.option'
  routingId?: string
  routeKey?: string
  tierIndex?: number
  optionIndex?: number
  parentDefinitionId?: string
  targetVariable?: string
  targetDefinitionId?: string
  targetKind?: ProjectDefinitionKind
  hasEvaluate?: boolean
  isDefault?: boolean
}

export interface RagFacts {
  kind: 'rag.pipeline' | 'rag.pipeline.stage' | 'rag.retriever'
  retrieverId?: string
  stageId?: string
  stageKind?: string
  topK?: number
}

export interface MemoryFacts {
  kind: 'memory' | 'blackboard'
  backend?: string
  runtimeIdPrefix?: string
  blockCount?: number
  evictionPolicy?: string
  conflictPolicy?: string
}

export interface MemoryStoreFacts {
  kind: 'memory.store'
  ownerDefinitionKey?: string
  backend?: string
  component?: string
  variableName?: string
}

export interface MemoryBlockFacts {
  kind: 'memory.block'
  memoryId: string
  blockId?: string
  blockKind?: string
  priority?: number
  writeMode?: string
  hasEmbed?: boolean
}

export interface WorkspaceFacts {
  kind: 'workspace'
  workspaceId?: string
  namespace?: string
  mounts?: Array<{ path: string; mode?: string }>
  hasTools?: boolean
}

export interface SafetyFacts {
  kind: 'constraint' | 'guardrail'
  appliesTo?: string[]
  policy?: string
  severity?: string
}

export interface ScorerFacts {
  kind: 'scorer'
  scorerId?: string
  model?: string
  threshold?: number
  scaleMin?: number
  scaleMax?: number
  hasRubric?: boolean
  hasDetailSchema?: boolean
  chainOfThought?: boolean
  criteriaPreview?: string
}

export interface EvalFacts {
  kind: 'dataset' | 'suite' | 'suite.case' | 'eval.prompt' | 'eval.flow' | 'eval.rag' | 'eval.quality'
  targetDefinitionId?: string
  suiteId?: string
  caseCount?: number
  scorerIds?: string[]
}

export type PrimitiveSpecificFacts =
  | PromptFacts
  | ContextFacts
  | InjectableFacts
  | ToolFacts
  | AgentFacts
  | FlowFacts
  | FlowStepFacts
  | CompositionFacts
  | CompositionChildFacts
  | RoutingFacts
  | RoutingChildFacts
  | RagFacts
  | MemoryFacts
  | MemoryStoreFacts
  | MemoryBlockFacts
  | WorkspaceFacts
  | SafetyFacts
  | ScorerFacts
  | EvalFacts

export type ProjectDefinitionFacts =
  | PrimitiveSpecificFacts
  | ({ kind: ProjectDefinitionKind; extensions?: Record<string, unknown> } & Record<string, unknown>)

export interface ProjectIdentity {
  root: string
  name?: string
  configFile?: string
}

export interface ProjectDefinition {
  id: string
  kind: ProjectDefinitionKind
  name: string
  description?: string
  tags?: string[]
  /** Authored namespace/tree path from createPrompts/createContexts/configure. */
  path?: string[]
  source?: SourceLocation
  sourceSnippet?: SourceSnippet
  sourceRefs?: ProjectSourceRef[]
  fidelity: DefinitionFidelity
  status?: 'active' | 'missing' | 'stale'
  fingerprint?: string
  metadata?: ProjectDefinitionMetadata
  quality?: ProjectDefinitionQuality
}

export interface ProjectDefinitionQuality {
  evalIds?: string[]
  suiteIds?: string[]
  experimentIds?: string[]
  baselineIds?: string[]
  comparisonIds?: string[]
  feedbackIds?: string[]
  cassettePaths?: string[]
  runIds?: string[]
  traceIds?: string[]
  affectedEvalIds?: string[]
  affectedSuiteIds?: string[]
  runCount?: number
  experimentCount?: number
  baselineCount?: number
  comparisonCount?: number
  feedbackCount?: number
  cassetteCount?: number
  completedRunCount?: number
  failedRunCount?: number
  runningRunCount?: number
  lastRunId?: string
  lastRunAt?: number
  lastStatus?: string
  caseCount?: number
  passRate?: number
  currentFingerprint?: string
  baselineFingerprint?: string
  changedSinceBaseline?: boolean
  drift?: {
    evals: ProjectDefinitionQualityDriftRow[]
    suites: ProjectDefinitionQualityDriftRow[]
  }
}

export interface ProjectDefinitionQualityDriftRow {
  id: string
  passRate: number
  runs: number
  baselineExperimentId: string
  baselinePassRate: number
  driftPp: number
}

export type ProjectRelationFidelity = DefinitionFidelity

export interface ProjectRelation {
  id: string
  type: string
  from: string
  to: string
  fidelity: ProjectRelationFidelity
  source?: SourceLocation
  metadata?: Record<string, unknown>
}

export interface CatalogDiagnostic {
  id: string
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  source?: SourceLocation
  relatedDefinitionIds?: string[]
  suggestedFix?: string
}

export type CruxLintCategory =
  | 'contracts'
  | 'observability'
  | 'evaluation'
  | 'safety'
  | 'memory'
  | 'runtime'
  | 'composition'
  | 'quality'

export type CruxLintMaturity = 'stable' | 'preview' | 'experimental'

export type CruxLintConfidence = 'high' | 'medium' | 'low'

export type CruxLintProfile = 'recommended' | 'strict' | 'experimental'

export type CruxLintSelectedProfile = 'off' | CruxLintProfile

export interface CruxLintRuleConfig {
  /** Disable a rule for this project. Prefer source suppressions for one-off exceptions. */
  enabled?: boolean
  /** Override a rule's displayed severity for this project. */
  severity?: CatalogLintFinding['severity']
}

export interface CruxLintConfig {
  /** Which rule profile the dev server and catalog health views should expose. @default 'recommended' */
  profile?: CruxLintSelectedProfile
  /** Project-level rule overrides keyed by rule id. */
  rules?: Record<string, CruxLintRuleConfig>
}

export interface CatalogLintEvidence {
  kind: 'definition' | 'relation' | 'quality' | 'runtime' | 'source'
  label: string
  description?: string
  definitionId?: string
  relationId?: string
  source?: SourceLocation
  data?: Record<string, unknown>
}

export interface CatalogLintFix {
  title: string
  description: string
  kind: 'manual' | 'docs' | 'config' | 'suppress' | 'code-action'
  docsUrl?: string
  command?: string
  suppression?: string
}

export interface CatalogLintFinding {
  id: string
  severity: 'info' | 'warning' | 'error'
  ruleId: string
  category: CruxLintCategory
  maturity: CruxLintMaturity
  confidence: CruxLintConfidence
  profiles: CruxLintProfile[]
  title: string
  message: string
  rationale: string
  impact?: string
  source?: SourceLocation
  primaryDefinitionId?: string
  relatedDefinitionIds: string[]
  affectedDefinitionIds?: string[]
  evidence: CatalogLintEvidence[]
  fixes: CatalogLintFix[]
  docsUrl: string
  suppression?: {
    supported: boolean
    directive: string
    scope: 'next-line' | 'line' | 'file'
  }
  suppressed?: boolean
  suppressedBy?: {
    source: SourceLocation
    reason?: string
  }
  propagatedDefinitionIds?: string[]
  propagationPaths?: Array<{
    fromDefinitionId: string
    toDefinitionId: string
    relationTypes: string[]
  }>
}

export interface CatalogSourceFile {
  file: string
  status: 'indexed' | 'partial' | 'error'
  definitionIds?: string[]
  dependencies?: string[]
  dependents?: string[]
  diagnostics?: string[]
}

export type CatalogIndexingPhase = 'cache' | 'ast' | 'semantic'

export interface CatalogIndexingPhaseStatus {
  status: 'pending' | 'running' | 'ready' | 'degraded'
  indexedAt?: string
  durationMs?: number
  fileCount?: number
  changedFileCount?: number
  diagnosticCount?: number
}

export interface ProjectCatalogIndexingStatus {
  status: 'cold' | 'cached' | 'refreshing' | 'ready' | 'degraded'
  ast: CatalogIndexingPhaseStatus
  semantic: Omit<CatalogIndexingPhaseStatus, 'status'> & {
    status: 'disabled' | CatalogIndexingPhaseStatus['status']
    enrichedDefinitionCount?: number
  }
  cache?: {
    status: 'miss' | 'hit' | 'stale' | 'invalid'
    loadedAt?: string
    snapshotAgeMs?: number
  }
}

/** Serialized metadata for a single prompt. */
export interface PromptMeta {
  id?: string
  description?: string
  tags: readonly string[]
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  contextIds: (string | undefined)[]
  hasOutput: boolean
  settings: Record<string, unknown>
  path?: string[]
  systemTemplate?: string | null
  promptTemplate?: string | null
  hasMessages?: boolean
  definitionSource?: SourceLocation
}

/** Serialized metadata for a registered tool. */
export interface ToolMeta {
  name: string
  description: string
  inputSchema?: JsonSchema
  path?: string[]
}

/** Serialized metadata for a single context. */
export interface ContextMeta {
  id?: string
  description?: string
  priority: number
  inputSchema?: JsonSchema
  isStatic: boolean
  usedBy: (string | undefined)[]
  path?: string[]
  systemTemplate?: string | null
  definitionSource?: SourceLocation
}

/** Full catalog/state snapshot registered with the devtools backend. */
export interface CatalogSnapshot {
  schemaVersion: 1
  prompts: PromptMeta[]
  contexts: ContextMeta[]
  tools?: ToolMeta[]
}

export interface ProjectCatalogSnapshot extends CatalogSnapshot {
  project: ProjectIdentity
  lint?: CruxLintConfig
  indexedAt: string
  indexing?: ProjectCatalogIndexingStatus
  sourceGraph?: ProjectCatalogSourceGraph
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: CatalogDiagnostic[]
  lintFindings: CatalogLintFinding[]
  sources: CatalogSourceFile[]
}

export interface ProjectCatalogSourceGraph {
  schemaVersion: 1
  producedBy: '@crux/source-indexer'
  capabilities: ProjectCatalogSourceGraphCapability[]
}

export type ProjectCatalogSourceGraphCapability =
  | 'source-dependencies'
  | 'source-dependents'
  | 'definition-ownership'
  | 'diagnostic-ownership'

export const JsonSchemaSchema = z.record(z.string(), z.unknown())

export const SourceLocationSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number().optional(),
  function: z.string().optional(),
})

export const SourceRangeSchema = z.object({
  file: z.string(),
  startLine: z.number(),
  endLine: z.number().optional(),
  startColumn: z.number().optional(),
  endColumn: z.number().optional(),
})

export const SourceSnippetSchema = z.object({
  source: z.string(),
  language: z.string().optional(),
  range: SourceRangeSchema,
  truncated: z.boolean().optional(),
})

export const ProjectIdentitySchema = z.object({
  root: z.string(),
  name: z.string().optional(),
  configFile: z.string().optional(),
}) satisfies z.ZodType<ProjectIdentity>

export const ProjectDefinitionKindSchema = z.enum([
  'prompt',
  'context',
  'tool',
  'agent',
  'flow',
  'flow.step',
  'composition.parallel',
  'composition.parallel.branch',
  'composition.pipeline',
  'composition.pipeline.stage',
  'composition.swarm',
  'composition.consensus',
  'routing.router',
  'routing.router.route',
  'routing.cascade',
  'routing.cascade.tier',
  'routing.fallback',
  'routing.fallback.option',
  'rag.pipeline',
  'rag.pipeline.stage',
  'rag.retriever',
  'memory',
  'memory.store',
  'memory.block',
  'blackboard',
  'workspace',
  'constraint',
  'guardrail',
  'scorer',
  'dataset',
  'suite',
  'suite.case',
  'eval.prompt',
  'eval.flow',
  'eval.rag',
  'eval.quality',
  'unknown',
])

export const DefinitionFidelitySchema = z.enum(['resolved', 'partial', 'error'])

export const ProjectSourceRefRoleSchema = z.enum([
  'schema',
  'callback',
  'handler',
  'execute',
  'prompt',
  'system',
  'resolver',
  'validator',
  'policy',
  'config',
  'helper',
])

export const ProjectSourceRefSchema = z.object({
  id: z.string(),
  role: ProjectSourceRefRoleSchema,
  property: z.string().optional(),
  symbol: z.string().optional(),
  source: SourceLocationSchema,
  snippet: SourceSnippetSchema.optional(),
  fidelity: z.enum(['resolved', 'partial']),
  description: z.string().optional(),
  metadata: z
    .object({
      schemaKind: z.enum(['zod', 'convex-validator', 'json-schema']).optional(),
      parsedSchema: z.boolean().optional(),
      referencedDefinitionIds: z.array(z.string()).optional(),
      dataAccess: z.boolean().optional(),
      injected: z.boolean().optional(),
      nested: z.boolean().optional(),
      fragment: z.boolean().optional(),
      factoryArg: z.boolean().optional(),
      argumentIndex: z.number().optional(),
      argumentName: z.string().optional(),
      toolMapContributor: z.enum(['spread', 'property']).optional(),
      routingTarget: z.boolean().optional(),
      extensions: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
}) satisfies z.ZodType<ProjectSourceRef>

export const PrimitiveIntelligenceConfidenceSchema = z.enum(['static', 'resolved', 'semantic', 'runtime', 'partial'])

export const PrimitiveSuspensionPointSchema = z.object({
  id: z.string(),
  label: z.string(),
  signal: z.string().optional(),
  source: SourceLocationSchema.optional(),
  resumesDefinitionId: z.string().optional(),
}) satisfies z.ZodType<PrimitiveSuspensionPoint>

export const SourceRefSummarySchema = z.object({
  id: z.string().optional(),
  role: ProjectSourceRefRoleSchema.optional(),
  property: z.string().optional(),
  symbol: z.string().optional(),
  source: SourceLocationSchema.optional(),
  fidelity: z.enum(['resolved', 'partial']).optional(),
  description: z.string().optional(),
}) satisfies z.ZodType<SourceRefSummary>

export const ContractFactsSchema = z.object({
  argsSchema: JsonSchemaSchema.optional(),
  inputSchema: JsonSchemaSchema.optional(),
  outputSchema: JsonSchemaSchema.optional(),
  configSchema: JsonSchemaSchema.optional(),
  schemaRefs: z.array(SourceRefSummarySchema).optional(),
  nestedSchemas: z
    .array(
      z.object({
        name: z.string(),
        schema: JsonSchemaSchema.optional(),
        source: SourceLocationSchema.optional(),
        role: z.enum(['input', 'output', 'args', 'config', 'field']),
      }),
    )
    .optional(),
  requiredFields: z.array(z.string()).optional(),
  optionalFields: z.array(z.string()).optional(),
  enumFields: z.array(z.object({ field: z.string(), values: z.array(z.string()) })).optional(),
}) satisfies z.ZodType<ContractFacts>

export const ControlFactsSchema = z.object({
  mode: z
    .enum(['sequential', 'parallel', 'fanout', 'consensus', 'swarm', 'durable', 'immediate', 'routing', 'cascade', 'fallback', 'event-driven'])
    .optional(),
  ordering: z.enum(['ordered', 'concurrent', 'event-driven', 'conditional', 'unknown']).optional(),
  children: z.array(z.string()).optional(),
  retryPolicy: z
    .object({
      maxAttempts: z.number().optional(),
      backoff: z.string().optional(),
      nonRetryableErrors: z.array(z.string()).optional(),
    })
    .catchall(z.unknown())
    .optional(),
  fallbackPolicy: z
    .object({
      optionCount: z.number().optional(),
      timeoutMs: z.number().optional(),
      shouldFallback: z.union([z.boolean(), z.literal('callback')]).optional(),
    })
    .catchall(z.unknown())
    .optional(),
  suspensionPoints: z.array(PrimitiveSuspensionPointSchema).optional(),
  budget: z
    .object({
      maxDurationMs: z.number().optional(),
      maxTokens: z.number().optional(),
      maxCostUsd: z.number().optional(),
    })
    .catchall(z.unknown())
    .optional(),
}) satisfies z.ZodType<ControlFacts>

export const DataAccessFactSchema = z.object({
  targetId: z.string().optional(),
  targetVariable: z.string().optional(),
  targetKind: z.enum(['memory', 'blackboard', 'workspace', 'store', 'block']).optional(),
  key: z.string().optional(),
  operation: z.enum(['read', 'write', 'append', 'update', 'delete', 'query']).optional(),
  source: SourceLocationSchema.optional(),
}) satisfies z.ZodType<DataAccessFact>

export const ArtifactFactSchema = z.object({
  name: z.string(),
  kind: z.string().optional(),
  source: SourceLocationSchema.optional(),
}) satisfies z.ZodType<ArtifactFact>

export const RetrievalFactSchema = z.object({
  retrieverId: z.string().optional(),
  memoryId: z.string().optional(),
  workspaceId: z.string().optional(),
  querySource: SourceLocationSchema.optional(),
  topK: z.number().optional(),
}) satisfies z.ZodType<RetrievalFact>

export const DataFactsSchema = z.object({
  reads: z.array(DataAccessFactSchema).optional(),
  writes: z.array(DataAccessFactSchema).optional(),
  artifacts: z.array(ArtifactFactSchema).optional(),
  retrievals: z.array(RetrievalFactSchema).optional(),
}) satisfies z.ZodType<DataFacts>

export const DependencyFactsSchema = z
  .object({
    prompts: z.array(z.string()).optional(),
    contexts: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    agents: z.array(z.string()).optional(),
    flows: z.array(z.string()).optional(),
    memory: z.array(z.string()).optional(),
    blackboards: z.array(z.string()).optional(),
    workspaces: z.array(z.string()).optional(),
    stores: z.array(z.string()).optional(),
    blocks: z.array(z.string()).optional(),
    routers: z.array(z.string()).optional(),
    ragPipelines: z.array(z.string()).optional(),
    retrievers: z.array(z.string()).optional(),
    guardrails: z.array(z.string()).optional(),
    constraints: z.array(z.string()).optional(),
    scorers: z.array(z.string()).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown()) satisfies z.ZodType<DependencyFacts>

export const IntelligenceDiagnosticSchema = z.object({
  code: z.string(),
  message: z.string(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
  source: SourceLocationSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<IntelligenceDiagnostic>

export const ProjectRuntimeJoinSchema = z
  .object({
    definitionId: z.string(),
    kind: ProjectDefinitionKindSchema,
    name: z.string(),
    primitive: z.string().optional(),
    spanName: z.string().optional(),
    flowName: z.string().optional(),
    stepLabel: z.string().optional(),
    parentDefinitionId: z.string().optional(),
    sourceDefinitionId: z.string().optional(),
    blockDefinitionId: z.string().optional(),
    blockId: z.string().optional(),
    blockKind: z.string().optional(),
    correlationAttributes: z.array(z.string()).optional(),
    spanAttributes: z.record(z.string(), z.string()).optional(),
    backend: z.string().optional(),
    resource: z.string().optional(),
    runtimeIdPrefix: z.string().optional(),
    promptId: z.string().optional(),
    contextId: z.string().optional(),
    agentId: z.string().optional(),
    toolName: z.string().optional(),
    retrieverId: z.string().optional(),
    memoryId: z.string().optional(),
    memoryStoreId: z.string().optional(),
    ragPipelineId: z.string().optional(),
    workspaceId: z.string().optional(),
    routingId: z.string().optional(),
    routeKey: z.string().optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown()) satisfies z.ZodType<ProjectRuntimeJoin>

export const RuntimeFactsSchema = z.object({
  join: ProjectRuntimeJoinSchema.optional(),
  expectedPrimitive: z.string().optional(),
  expectedSpanName: z.string().optional(),
  correlationAttributes: z.array(z.string()).optional(),
  spanAttributes: z.record(z.string(), z.string()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<RuntimeFacts>

export const PrimitiveIntelligenceSchema = z.object({
  confidence: PrimitiveIntelligenceConfidenceSchema,
  contract: ContractFactsSchema.optional(),
  control: ControlFactsSchema.optional(),
  data: DataFactsSchema.optional(),
  dependencies: DependencyFactsSchema.optional(),
  runtime: RuntimeFactsSchema.optional(),
  diagnostics: z.array(IntelligenceDiagnosticSchema).optional(),
  runtimeJoin: ProjectRuntimeJoinSchema.optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<PrimitiveIntelligence>

export const ProjectDefinitionCatalogPresentationSchema = z.object({
  standalone: z.boolean(),
  parentDefinitionId: z.string().optional(),
  parentRelationType: z.string().optional(),
  role: z.enum(['step', 'branch', 'stage', 'route', 'tier', 'option', 'block', 'store', 'case']).optional(),
  order: z.number().optional(),
}) satisfies z.ZodType<ProjectDefinitionCatalogPresentation>

export const ProjectDefinitionMetadataSchema = z
  .object({
    argsSchema: JsonSchemaSchema.optional(),
    inputSchema: JsonSchemaSchema.optional(),
    outputSchema: JsonSchemaSchema.optional(),
    configSchema: JsonSchemaSchema.optional(),
    schema: JsonSchemaSchema.optional(),
    catalogPresentation: ProjectDefinitionCatalogPresentationSchema.optional(),
    facts: z.object({ kind: ProjectDefinitionKindSchema }).catchall(z.unknown()).optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
    intelligence: PrimitiveIntelligenceSchema.optional(),
    runtimeJoin: ProjectRuntimeJoinSchema.optional(),
    sourceStatus: z
      .object({
        importSafe: z.boolean().optional(),
        partialReason: z.string().optional(),
        confidence: PrimitiveIntelligenceConfidenceSchema.optional(),
      })
      .optional(),
    updated: z
      .object({
        lastEditedAt: z.string().optional(),
        lastEditedAtMs: z.number().optional(),
        sourceMtime: z.boolean().optional(),
      })
      .optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .catchall(z.unknown()) satisfies z.ZodType<ProjectDefinitionMetadata>

export const ProjectDefinitionQualitySchema = z.object({
  evalIds: z.array(z.string()).optional(),
  suiteIds: z.array(z.string()).optional(),
  experimentIds: z.array(z.string()).optional(),
  baselineIds: z.array(z.string()).optional(),
  comparisonIds: z.array(z.string()).optional(),
  feedbackIds: z.array(z.string()).optional(),
  cassettePaths: z.array(z.string()).optional(),
  runIds: z.array(z.string()).optional(),
  traceIds: z.array(z.string()).optional(),
  affectedEvalIds: z.array(z.string()).optional(),
  affectedSuiteIds: z.array(z.string()).optional(),
  runCount: z.number().optional(),
  experimentCount: z.number().optional(),
  baselineCount: z.number().optional(),
  comparisonCount: z.number().optional(),
  feedbackCount: z.number().optional(),
  cassetteCount: z.number().optional(),
  completedRunCount: z.number().optional(),
  failedRunCount: z.number().optional(),
  runningRunCount: z.number().optional(),
  lastRunId: z.string().optional(),
  lastRunAt: z.number().optional(),
  lastStatus: z.string().optional(),
  caseCount: z.number().optional(),
  passRate: z.number().optional(),
  currentFingerprint: z.string().optional(),
  baselineFingerprint: z.string().optional(),
  changedSinceBaseline: z.boolean().optional(),
}) satisfies z.ZodType<ProjectDefinitionQuality>

export const ProjectDefinitionSchema = z.object({
  id: z.string(),
  kind: ProjectDefinitionKindSchema,
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  path: z.array(z.string()).optional(),
  source: SourceLocationSchema.optional(),
  sourceSnippet: SourceSnippetSchema.optional(),
  sourceRefs: z.array(ProjectSourceRefSchema).optional(),
  fidelity: DefinitionFidelitySchema,
  status: z.enum(['active', 'missing', 'stale']).optional(),
  fingerprint: z.string().optional(),
  metadata: ProjectDefinitionMetadataSchema.optional(),
  quality: ProjectDefinitionQualitySchema.optional(),
}) satisfies z.ZodType<ProjectDefinition>

export const ProjectRelationSchema = z.object({
  id: z.string(),
  type: z.string(),
  from: z.string(),
  to: z.string(),
  fidelity: DefinitionFidelitySchema,
  source: SourceLocationSchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<ProjectRelation>

export const CatalogDiagnosticSchema = z.object({
  id: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  code: z.string(),
  message: z.string(),
  source: SourceLocationSchema.optional(),
  relatedDefinitionIds: z.array(z.string()).optional(),
  suggestedFix: z.string().optional(),
}) satisfies z.ZodType<CatalogDiagnostic>

export const CruxLintCategorySchema = z.enum([
  'contracts',
  'observability',
  'evaluation',
  'safety',
  'memory',
  'runtime',
  'composition',
  'quality',
])

export const CruxLintMaturitySchema = z.enum(['stable', 'preview', 'experimental'])

export const CruxLintConfidenceSchema = z.enum(['high', 'medium', 'low'])

export const CruxLintProfileSchema = z.enum(['recommended', 'strict', 'experimental'])

export const CruxLintSelectedProfileSchema = z.enum(['off', 'recommended', 'strict', 'experimental'])

export const CruxLintRuleConfigSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(['info', 'warning', 'error']).optional(),
}) satisfies z.ZodType<CruxLintRuleConfig>

export const CruxLintConfigSchema = z.object({
  profile: CruxLintSelectedProfileSchema.optional(),
  rules: z.record(z.string(), CruxLintRuleConfigSchema).optional(),
}) satisfies z.ZodType<CruxLintConfig>

export const CatalogLintEvidenceSchema = z.object({
  kind: z.enum(['definition', 'relation', 'quality', 'runtime', 'source']),
  label: z.string(),
  description: z.string().optional(),
  definitionId: z.string().optional(),
  relationId: z.string().optional(),
  source: SourceLocationSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<CatalogLintEvidence>

export const CatalogLintFixSchema = z.object({
  title: z.string(),
  description: z.string(),
  kind: z.enum(['manual', 'docs', 'config', 'suppress', 'code-action']),
  docsUrl: z.string().optional(),
  command: z.string().optional(),
  suppression: z.string().optional(),
}) satisfies z.ZodType<CatalogLintFix>

export const CatalogLintFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  ruleId: z.string(),
  category: CruxLintCategorySchema,
  maturity: CruxLintMaturitySchema,
  confidence: CruxLintConfidenceSchema,
  profiles: z.array(CruxLintProfileSchema),
  title: z.string(),
  message: z.string(),
  rationale: z.string(),
  impact: z.string().optional(),
  source: SourceLocationSchema.optional(),
  primaryDefinitionId: z.string().optional(),
  relatedDefinitionIds: z.array(z.string()),
  affectedDefinitionIds: z.array(z.string()).optional(),
  evidence: z.array(CatalogLintEvidenceSchema),
  fixes: z.array(CatalogLintFixSchema),
  docsUrl: z.string(),
  suppression: z
    .object({
      supported: z.boolean(),
      directive: z.string(),
      scope: z.enum(['next-line', 'line', 'file']),
    })
    .optional(),
  suppressed: z.boolean().optional(),
  suppressedBy: z
    .object({
      source: SourceLocationSchema,
      reason: z.string().optional(),
    })
    .optional(),
  propagatedDefinitionIds: z.array(z.string()).optional(),
  propagationPaths: z
    .array(
      z.object({
        fromDefinitionId: z.string(),
        toDefinitionId: z.string(),
        relationTypes: z.array(z.string()),
      }),
    )
    .optional(),
}) satisfies z.ZodType<CatalogLintFinding>

export const CatalogSourceFileSchema = z.object({
  file: z.string(),
  status: z.enum(['indexed', 'partial', 'error']),
  definitionIds: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  dependents: z.array(z.string()).optional(),
  diagnostics: z.array(z.string()).optional(),
}) satisfies z.ZodType<CatalogSourceFile>

export const CatalogIndexingPhaseStatusSchema = z.object({
  status: z.enum(['pending', 'running', 'ready', 'degraded']),
  indexedAt: z.string().optional(),
  durationMs: z.number().optional(),
  fileCount: z.number().optional(),
  changedFileCount: z.number().optional(),
  diagnosticCount: z.number().optional(),
}) satisfies z.ZodType<CatalogIndexingPhaseStatus>

export const ProjectCatalogIndexingStatusSchema = z.object({
  status: z.enum(['cold', 'cached', 'refreshing', 'ready', 'degraded']),
  ast: CatalogIndexingPhaseStatusSchema,
  semantic: CatalogIndexingPhaseStatusSchema.omit({ status: true }).extend({
    status: z.enum(['disabled', 'pending', 'running', 'ready', 'degraded']),
    enrichedDefinitionCount: z.number().optional(),
  }),
  cache: z
    .object({
      status: z.enum(['miss', 'hit', 'stale', 'invalid']),
      loadedAt: z.string().optional(),
      snapshotAgeMs: z.number().optional(),
    })
    .optional(),
}) satisfies z.ZodType<ProjectCatalogIndexingStatus>

export const PromptMetaSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  inputSchema: JsonSchemaSchema.optional(),
  outputSchema: JsonSchemaSchema.optional(),
  contextIds: z.array(z.string().optional()),
  hasOutput: z.boolean(),
  settings: z.record(z.string(), z.unknown()),
  path: z.array(z.string()).optional(),
  systemTemplate: z.string().nullable().optional(),
  promptTemplate: z.string().nullable().optional(),
  hasMessages: z.boolean().optional(),
  definitionSource: SourceLocationSchema.optional(),
}) satisfies z.ZodType<PromptMeta>

export const ContextMetaSchema = z.object({
  id: z.string().optional(),
  description: z.string().optional(),
  priority: z.number(),
  inputSchema: JsonSchemaSchema.optional(),
  isStatic: z.boolean(),
  usedBy: z.array(z.string().optional()),
  path: z.array(z.string()).optional(),
  systemTemplate: z.string().nullable().optional(),
  definitionSource: SourceLocationSchema.optional(),
}) satisfies z.ZodType<ContextMeta>

export const ToolMetaSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: JsonSchemaSchema.optional(),
  path: z.array(z.string()).optional(),
}) satisfies z.ZodType<ToolMeta>

export const CatalogSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  prompts: z.array(PromptMetaSchema),
  contexts: z.array(ContextMetaSchema),
  tools: z.array(ToolMetaSchema).optional(),
}) satisfies z.ZodType<CatalogSnapshot>

export const ProjectCatalogSnapshotSchema = CatalogSnapshotSchema.extend({
  project: ProjectIdentitySchema,
  lint: CruxLintConfigSchema.optional(),
  indexedAt: z.string(),
  indexing: ProjectCatalogIndexingStatusSchema.optional(),
  sourceGraph: z
    .object({
      schemaVersion: z.literal(1),
      producedBy: z.literal('@crux/source-indexer'),
      capabilities: z.array(
        z.enum(['source-dependencies', 'source-dependents', 'definition-ownership', 'diagnostic-ownership']),
      ),
    })
    .optional(),
  definitions: z.array(ProjectDefinitionSchema),
  relations: z.array(ProjectRelationSchema),
  diagnostics: z.array(CatalogDiagnosticSchema),
  lintFindings: z.array(CatalogLintFindingSchema),
  sources: z.array(CatalogSourceFileSchema),
}) satisfies z.ZodType<ProjectCatalogSnapshot>
