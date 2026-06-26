import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleDescriptor,
  ContextMeta,
  CruxLintConfig,
  IndexSourceFile,
  ProjectIndexingStatus,
  ProjectIndexSnapshot,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
  ProjectSourceRef,
  PromptMeta,
  ToolMeta,
} from '@use-crux/core/project-index'
import type { SemanticSourceProfile } from './semantic/source-profile'
import { relationIdentity, withResolvedRelationReadModel } from './relations'

export type IndexPatchPhase = 'cache' | 'ast' | 'semantic' | 'runtime' | 'quality'
export type IndexPatchStatus = 'ok' | 'partial' | 'degraded'

export interface IndexSourceRefFact {
  readonly definitionId: string
  readonly ref: ProjectSourceRef
}

export interface IndexPatchFacts {
  readonly prompts?: readonly PromptMeta[]
  readonly contexts?: readonly ContextMeta[]
  readonly tools?: readonly ToolMeta[]
  readonly lint?: CruxLintConfig
  readonly definitions?: readonly ProjectDefinition[]
  readonly relations?: readonly ProjectRelation[]
  readonly sourceRefs?: readonly IndexSourceRefFact[]
  readonly diagnostics?: readonly IndexDiagnostic[]
  readonly lintFindings?: readonly IndexLintFinding[]
  readonly ruleDescriptors?: readonly IndexRuleDescriptor[]
  readonly sources?: readonly IndexSourceFile[]
  readonly sourceGraph?: ProjectIndexSnapshot['sourceGraph']
}

export interface IndexPatchBudget {
  readonly maxFiles?: number
  /** Maximum UTF-8 source bytes considered by a preflight indexing phase. */
  readonly maxSourceBytes?: number
  /** Maximum files added to semantic analysis from a previous Project Index. */
  readonly maxPreviousSourceExpansion?: number
  /** Maximum local source files reached from semantic roots before enrichment. */
  readonly maxDependencyClosureFiles?: number
  readonly maxDefinitions?: number
  readonly maxRelations?: number
  readonly maxSourceRefs?: number
  readonly maxDiagnostics?: number
  readonly maxLintFindings?: number
  readonly maxSources?: number
  readonly maxBytes?: number
}

type IndexPatchBudgetMetric =
  | 'files'
  | 'sourceBytes'
  | 'previousSourceExpansion'
  | 'dependencyClosureFiles'
  | 'definitions'
  | 'relations'
  | 'sourceRefs'
  | 'diagnostics'
  | 'lintFindings'
  | 'sources'
  | 'bytes'

interface IndexPatchBudgetViolation {
  readonly metric: IndexPatchBudgetMetric
  readonly actual: number
  readonly limit: number
}

interface IndexPatchBudgetUsage {
  readonly fileCount?: number
  readonly sourceBytes?: number
  readonly previousSourceExpansion?: number
  readonly dependencyClosureFiles?: number
}

export interface IndexPatch {
  readonly schemaVersion: 1
  readonly phase: IndexPatchPhase
  readonly project: ProjectIdentity
  readonly startedAt: string
  readonly finishedAt?: string
  readonly status: IndexPatchStatus
  readonly indexing?: ProjectIndexingStatus
  readonly facts: IndexPatchFacts
  /** Internal compiler handoff from AST/source indexing to semantic indexing; not part of the read model. */
  readonly semanticSourceProfile?: SemanticSourceProfile
  readonly invalidates?: {
    readonly files?: readonly string[]
    readonly definitionIds?: readonly string[]
    readonly all?: boolean
  }
}

export function enforceIndexPatchBudget(
  patch: IndexPatch,
  budget: IndexPatchBudget | undefined,
  usage: IndexPatchBudgetUsage = {},
): IndexPatch {
  const violations = indexPatchBudgetViolations(patch, budget, usage)
  if (violations.length === 0) return patch

  return {
    ...patch,
    status: 'degraded',
    facts: {
      diagnostics: [indexPatchBudgetDiagnostic(patch, violations)],
    },
  }
}

export interface IndexPatchState {
  readonly project?: ProjectIdentity
  readonly indexedAt?: string
  readonly indexing?: ProjectIndexingStatus
  readonly sourceGraph?: ProjectIndexSnapshot['sourceGraph']
  readonly prompts: readonly PromptMeta[]
  readonly contexts: readonly ContextMeta[]
  readonly tools: readonly ToolMeta[]
  readonly lint?: CruxLintConfig
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly lintFindings: readonly IndexLintFinding[]
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
  readonly sources: readonly IndexSourceFile[]
  readonly diagnosticsByPhase: Readonly<Partial<Record<IndexPatchPhase, readonly IndexDiagnostic[]>>>
  readonly definitionPhases: Readonly<Record<string, IndexPatchPhase>>
  readonly relationPhases: Readonly<Record<string, IndexPatchPhase>>
  readonly lintFindingPhases: Readonly<Record<string, IndexPatchPhase>>
  readonly sourcePhases: Readonly<Record<string, IndexPatchPhase>>
}

function indexPatchBudgetViolations(
  patch: IndexPatch,
  budget: IndexPatchBudget | undefined,
  usage: IndexPatchBudgetUsage,
): IndexPatchBudgetViolation[] {
  if (!budget) return []
  const violations: IndexPatchBudgetViolation[] = []
  addViolation(violations, 'files', usage.fileCount ?? 0, budget.maxFiles)
  addViolation(violations, 'sourceBytes', usage.sourceBytes ?? 0, budget.maxSourceBytes)
  addViolation(
    violations,
    'previousSourceExpansion',
    usage.previousSourceExpansion ?? 0,
    budget.maxPreviousSourceExpansion,
  )
  addViolation(
    violations,
    'dependencyClosureFiles',
    usage.dependencyClosureFiles ?? 0,
    budget.maxDependencyClosureFiles,
  )
  addViolation(violations, 'definitions', patch.facts.definitions?.length ?? 0, budget.maxDefinitions)
  addViolation(violations, 'relations', patch.facts.relations?.length ?? 0, budget.maxRelations)
  addViolation(violations, 'sourceRefs', patch.facts.sourceRefs?.length ?? 0, budget.maxSourceRefs)
  addViolation(violations, 'diagnostics', patch.facts.diagnostics?.length ?? 0, budget.maxDiagnostics)
  addViolation(violations, 'lintFindings', patch.facts.lintFindings?.length ?? 0, budget.maxLintFindings)
  addViolation(violations, 'sources', patch.facts.sources?.length ?? 0, budget.maxSources)
  if (budget.maxBytes !== undefined) {
    addViolation(violations, 'bytes', new TextEncoder().encode(JSON.stringify(patch)).byteLength, budget.maxBytes)
  }
  return violations
}

function addViolation(
  violations: IndexPatchBudgetViolation[],
  metric: IndexPatchBudgetMetric,
  actual: number,
  limit: number | undefined,
): void {
  if (limit !== undefined && actual > limit) violations.push({ metric, actual, limit })
}

function indexPatchBudgetDiagnostic(
  patch: IndexPatch,
  violations: readonly IndexPatchBudgetViolation[],
): IndexDiagnostic {
  const summary = violations.map((violation) => `${violation.metric} ${violation.actual}/${violation.limit}`).join(', ')
  return {
    id: `diagnostic:${patch.phase}:budget-exceeded`,
    severity: 'info',
    code: `index.${patch.phase}_budget_exceeded`,
    message: `Index ${patch.phase} patch exceeded its budget (${summary}); ${patch.phase} facts were skipped to keep indexing bounded.`,
    suggestedFix:
      'Reduce project index complexity or wait for finer-grained semantic chunking before enabling richer enrichment.',
  }
}

export function emptyIndexPatchState(): IndexPatchState {
  return {
    prompts: [],
    contexts: [],
    tools: [],
    definitions: [],
    relations: [],
    diagnostics: [],
    lintFindings: [],
    ruleDescriptors: [],
    sources: [],
    diagnosticsByPhase: {},
    definitionPhases: {},
    relationPhases: {},
    lintFindingPhases: {},
    sourcePhases: {},
  }
}

export function indexPatchFromSnapshot(
  snapshot: ProjectIndexSnapshot,
  phase: IndexPatchPhase = 'ast',
  status: IndexPatchStatus = 'ok',
): IndexPatch {
  return {
    schemaVersion: 1,
    phase,
    project: snapshot.project,
    startedAt: snapshot.indexedAt,
    finishedAt: snapshot.indexedAt,
    status,
    indexing: snapshot.indexing,
    invalidates: { all: true },
    facts: {
      prompts: snapshot.prompts,
      contexts: snapshot.contexts,
      tools: snapshot.tools,
      lint: snapshot.lint,
      definitions: snapshot.definitions,
      relations: snapshot.relations,
      diagnostics: snapshot.diagnostics,
      lintFindings: snapshot.lintFindings,
      ruleDescriptors: snapshot.ruleDescriptors,
      sources: snapshot.sources,
      sourceGraph: snapshot.sourceGraph,
    },
  }
}

export function applyIndexPatch(state: IndexPatchState, patch: IndexPatch): IndexPatchState {
  const base = patch.invalidates?.all ? emptyIndexPatchState() : invalidateIndexPatchState(state, patch)
  const prompts = patch.facts.prompts ? [...patch.facts.prompts] : base.prompts
  const contexts = patch.facts.contexts ? [...patch.facts.contexts] : base.contexts
  const tools = patch.facts.tools ? [...patch.facts.tools] : base.tools
  const definitions = mergeDefinitionsForPatch(base.definitions, base.definitionPhases, patch)
  const definitionPhases = updateFactPhases(
    base.definitionPhases,
    patch.phase,
    patch.facts.definitions?.map((fact) => fact.id),
  )
  const definitionsWithRefs = applySourceRefFacts(definitions, patch.facts.sourceRefs)
  const relations = mergeFactsById(
    base.relations,
    base.relationPhases,
    patch.phase,
    patch.facts.relations,
    relationFactKey,
  )
  const relationPhases = updateFactPhases(base.relationPhases, patch.phase, patch.facts.relations?.map(relationFactKey))
  const finalizedDefinitions = withResolvedRelationReadModel(definitionsWithRefs, relations)
  const lintFindings = mergeFactsById(base.lintFindings, base.lintFindingPhases, patch.phase, patch.facts.lintFindings)
  const ruleDescriptors = patch.facts.ruleDescriptors ? [...patch.facts.ruleDescriptors] : base.ruleDescriptors
  const lintFindingPhases = updateFactPhases(
    base.lintFindingPhases,
    patch.phase,
    patch.facts.lintFindings?.map((fact) => fact.id),
  )
  const sources = mergeSourcesForPatch(base.sources, base.sourcePhases, patch)
  const sourcePhases = updateFactPhases(
    base.sourcePhases,
    patch.phase,
    patch.facts.sources?.map((source) => source.file),
  )
  const diagnosticsByPhase = mergeDiagnosticsByPhase(base.diagnosticsByPhase, patch)

  return {
    project: patch.project ?? base.project,
    indexedAt: patch.finishedAt ?? base.indexedAt,
    indexing: patch.indexing ?? base.indexing,
    prompts,
    contexts,
    tools,
    lint: patch.facts.lint ?? base.lint,
    sourceGraph: patch.facts.sourceGraph ?? base.sourceGraph,
    definitions: finalizedDefinitions,
    relations,
    diagnostics: diagnosticsFromPhases(diagnosticsByPhase),
    lintFindings,
    ruleDescriptors,
    sources,
    diagnosticsByPhase,
    definitionPhases,
    relationPhases,
    lintFindingPhases,
    sourcePhases,
  }
}

function mergeSourcesForPatch(
  existing: readonly IndexSourceFile[],
  phases: Readonly<Record<string, IndexPatchPhase>>,
  patch: IndexPatch,
): IndexSourceFile[] {
  const merged = new Map(existing.map((source) => [source.file, source]))
  if (!patch.facts.sources?.length) return [...merged.values()]

  for (const source of patch.facts.sources) {
    const current = merged.get(source.file)
    const currentPhase = phases[source.file] ?? 'cache'
    if (current && phaseRank(patch.phase) < phaseRank(currentPhase)) continue
    merged.set(source.file, current ? mergeIndexSourceFile(current, source) : source)
  }
  return [...merged.values()]
}

function mergeIndexSourceFile(existing: IndexSourceFile, incoming: IndexSourceFile): IndexSourceFile {
  return {
    file: incoming.file,
    status: mergeSourceStatus(existing.status, incoming.status),
    definitionIds: mergeStringLists(existing.definitionIds, incoming.definitionIds),
    dependencies: mergeStringLists(existing.dependencies, incoming.dependencies),
    dependents: mergeStringLists(existing.dependents, incoming.dependents),
    diagnostics: mergeStringLists(existing.diagnostics, incoming.diagnostics),
  }
}

function mergeSourceStatus(
  existing: IndexSourceFile['status'],
  incoming: IndexSourceFile['status'],
): IndexSourceFile['status'] {
  if (existing === 'error' || incoming === 'error') return 'error'
  if (existing === 'partial' || incoming === 'partial') return 'partial'
  return 'indexed'
}

function mergeStringLists(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
): string[] | undefined {
  if (existing === undefined && incoming === undefined) return undefined
  const merged = [...new Set([...(existing ?? []), ...(incoming ?? [])])].sort()
  return merged
}

function mergeDiagnosticsByPhase(
  existing: Readonly<Partial<Record<IndexPatchPhase, readonly IndexDiagnostic[]>>>,
  patch: IndexPatch,
): Readonly<Partial<Record<IndexPatchPhase, readonly IndexDiagnostic[]>>> {
  if (!patch.facts.diagnostics) return existing
  const shouldMergePhase = patch.invalidates !== undefined && patch.invalidates.all !== true
  return {
    ...existing,
    [patch.phase]: shouldMergePhase
      ? mergeFactsById(existing[patch.phase] ?? [], {}, patch.phase, patch.facts.diagnostics)
      : patch.facts.diagnostics,
  }
}

function invalidateIndexPatchState(state: IndexPatchState, patch: IndexPatch): IndexPatchState {
  const invalidatedFiles = new Set(patch.invalidates?.files ?? [])
  const initialDefinitionIds = new Set(patch.invalidates?.definitionIds ?? [])
  if (invalidatedFiles.size === 0 && initialDefinitionIds.size === 0) return state

  const invalidatedSourceRows = state.sources.filter((source) => invalidatedFiles.has(source.file))
  const invalidatedDefinitionIds = new Set([
    ...initialDefinitionIds,
    ...invalidatedSourceRows.flatMap((source) => source.definitionIds ?? []),
    ...state.definitions
      .filter((definition) => definition.source?.file && invalidatedFiles.has(definition.source.file))
      .map((definition) => definition.id),
  ])
  const invalidatedDiagnosticIds = new Set(invalidatedSourceRows.flatMap((source) => source.diagnostics ?? []))

  const definitions = state.definitions.filter(
    (definition) =>
      !invalidatedDefinitionIds.has(definition.id) &&
      !(definition.source?.file && invalidatedFiles.has(definition.source.file)),
  )
  const relations = state.relations.filter(
    (relation) => !invalidatedDefinitionIds.has(relation.from) && !invalidatedDefinitionIds.has(relation.to),
  )
  const lintFindings = state.lintFindings.filter(
    (finding) =>
      !lintFindingReferencesDefinitions(finding, invalidatedDefinitionIds) &&
      !(finding.source?.file && invalidatedFiles.has(finding.source.file)),
  )
  const diagnosticsByPhase = filterDiagnosticsByPhase(
    state.diagnosticsByPhase,
    invalidatedFiles,
    invalidatedDiagnosticIds,
    invalidatedDefinitionIds,
  )
  const sources = state.sources.filter((source) => !invalidatedFiles.has(source.file))

  return {
    ...state,
    definitions,
    relations,
    diagnostics: diagnosticsFromPhases(diagnosticsByPhase),
    lintFindings,
    sources,
    diagnosticsByPhase,
    definitionPhases: filterRecordKeys(state.definitionPhases, invalidatedDefinitionIds),
    relationPhases: filterRecordKeys(
      state.relationPhases,
      new Set(
        state.relations
          .filter(
            (relation) => invalidatedDefinitionIds.has(relation.from) || invalidatedDefinitionIds.has(relation.to),
          )
          .map(relationFactKey),
      ),
    ),
    lintFindingPhases: filterRecordKeys(
      state.lintFindingPhases,
      new Set(
        state.lintFindings
          .filter(
            (finding) =>
              lintFindingReferencesDefinitions(finding, invalidatedDefinitionIds) ||
              (finding.source?.file !== undefined && invalidatedFiles.has(finding.source.file)),
          )
          .map((finding) => finding.id),
      ),
    ),
    sourcePhases: filterRecordKeys(state.sourcePhases, invalidatedFiles),
  }
}

function filterDiagnosticsByPhase(
  diagnosticsByPhase: Readonly<Partial<Record<IndexPatchPhase, readonly IndexDiagnostic[]>>>,
  invalidatedFiles: ReadonlySet<string>,
  invalidatedDiagnosticIds: ReadonlySet<string>,
  invalidatedDefinitionIds: ReadonlySet<string>,
): Readonly<Partial<Record<IndexPatchPhase, readonly IndexDiagnostic[]>>> {
  const next: Partial<Record<IndexPatchPhase, readonly IndexDiagnostic[]>> = {}
  for (const phase of phaseOrder) {
    const diagnostics = diagnosticsByPhase[phase]
    if (!diagnostics) continue
    next[phase] = diagnostics.filter(
      (diagnostic) =>
        !invalidatedDiagnosticIds.has(diagnostic.id) &&
        !(diagnostic.source?.file && invalidatedFiles.has(diagnostic.source.file)) &&
        !(diagnostic.relatedDefinitionIds?.some((id) => invalidatedDefinitionIds.has(id)) ?? false),
    )
  }
  return next
}

function lintFindingReferencesDefinitions(finding: IndexLintFinding, definitionIds: ReadonlySet<string>): boolean {
  return (
    (finding.primaryDefinitionId !== undefined && definitionIds.has(finding.primaryDefinitionId)) ||
    finding.relatedDefinitionIds.some((id) => definitionIds.has(id)) ||
    (finding.affectedDefinitionIds?.some((id) => definitionIds.has(id)) ?? false) ||
    finding.evidence.some(
      (evidence) => evidence.definitionId !== undefined && definitionIds.has(evidence.definitionId),
    ) ||
    (finding.propagatedDefinitionIds?.some((id) => definitionIds.has(id)) ?? false) ||
    (finding.propagationPaths?.some(
      (path) => definitionIds.has(path.fromDefinitionId) || definitionIds.has(path.toDefinitionId),
    ) ??
      false)
  )
}

function filterRecordKeys<T>(record: Readonly<Record<string, T>>, removedKeys: ReadonlySet<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !removedKeys.has(key)))
}

function mergeDefinitionsForPatch(
  existing: readonly ProjectDefinition[],
  phases: Readonly<Record<string, IndexPatchPhase>>,
  patch: IndexPatch,
): ProjectDefinition[] {
  const merged = new Map(existing.map((definition) => [definition.id, definition]))
  if (!patch.facts.definitions?.length) return [...merged.values()]

  for (const incoming of patch.facts.definitions) {
    const current = merged.get(incoming.id)
    if (!current) {
      if (patch.phase !== 'semantic') merged.set(incoming.id, incoming)
      continue
    }
    const currentPhase = phases[incoming.id] ?? 'cache'
    if (phaseRank(patch.phase) < phaseRank(currentPhase)) continue
    merged.set(incoming.id, mergeDefinitionForPatch(current, currentPhase, incoming, patch.phase))
  }
  return [...merged.values()]
}

function mergeDefinitionForPatch(
  existing: ProjectDefinition,
  existingPhase: IndexPatchPhase,
  incoming: ProjectDefinition,
  incomingPhase: IndexPatchPhase,
): ProjectDefinition {
  if (existingPhase === 'cache' && incomingPhase !== 'cache') return incoming
  if (incomingPhase === 'semantic') {
    return {
      ...existing,
      description: incoming.description ?? existing.description,
      metadata: mergeMetadata(existing.metadata, incoming.metadata),
      quality: incoming.quality ?? existing.quality,
      sourceRefs: mergeSourceRefs(existing.sourceRefs, incoming.sourceRefs),
    }
  }

  return {
    ...existing,
    ...incoming,
    source: incoming.source ?? existing.source,
    sourceSnippet: incoming.sourceSnippet ?? existing.sourceSnippet,
    description: incoming.description ?? existing.description,
    tags: incoming.tags ?? existing.tags,
    path: incoming.path ?? existing.path,
    fidelity:
      phaseRank(incomingPhase) >= phaseRank(existingPhase) &&
      fidelityRank(incoming.fidelity) >= fidelityRank(existing.fidelity)
        ? incoming.fidelity
        : existing.fidelity,
    status: incoming.status ?? existing.status,
    fingerprint: incoming.fingerprint ?? existing.fingerprint,
    metadata: mergeMetadata(existing.metadata, incoming.metadata),
    quality: incoming.quality ?? existing.quality,
    sourceRefs: mergeSourceRefs(existing.sourceRefs, incoming.sourceRefs),
  }
}

function applySourceRefFacts(
  definitions: readonly ProjectDefinition[],
  sourceRefs: readonly IndexSourceRefFact[] | undefined,
): ProjectDefinition[] {
  if (!sourceRefs?.length) return [...definitions]
  const refsByDefinition = new Map<string, ProjectSourceRef[]>()
  for (const fact of sourceRefs) {
    const refs = refsByDefinition.get(fact.definitionId) ?? []
    refs.push(fact.ref)
    refsByDefinition.set(fact.definitionId, refs)
  }
  return definitions.map((definition) => {
    const refs = refsByDefinition.get(definition.id)
    if (!refs) return definition
    return { ...definition, sourceRefs: mergeSourceRefs(definition.sourceRefs, refs) }
  })
}

function mergeFactsById<T>(
  existing: readonly T[],
  phases: Readonly<Record<string, IndexPatchPhase>>,
  phase: IndexPatchPhase,
  incoming: readonly T[] | undefined,
  idFor: (fact: T) => string = (fact) => (fact as { readonly id: string }).id,
): T[] {
  const merged = new Map(existing.map((fact) => [idFor(fact), fact]))
  if (!incoming?.length) return [...merged.values()]

  for (const fact of incoming) {
    const id = idFor(fact)
    const currentPhase = phases[id] ?? 'cache'
    if (merged.has(id) && phaseRank(phase) < phaseRank(currentPhase)) continue
    merged.set(id, fact)
  }
  return [...merged.values()]
}

const relationFactKey: (relation: ProjectRelation) => string = relationIdentity

function updateFactPhases(
  existing: Readonly<Record<string, IndexPatchPhase>>,
  phase: IndexPatchPhase,
  ids: readonly string[] | undefined,
): Record<string, IndexPatchPhase> {
  if (!ids?.length) return { ...existing }
  const next = { ...existing }
  for (const id of ids) {
    const current = next[id]
    if (!current || phaseRank(phase) >= phaseRank(current)) next[id] = phase
  }
  return next
}

function diagnosticsFromPhases(
  diagnosticsByPhase: Readonly<Partial<Record<IndexPatchPhase, readonly IndexDiagnostic[]>>>,
): IndexDiagnostic[] {
  return phaseOrder.flatMap((phase) => diagnosticsByPhase[phase] ?? [])
}

const phaseOrder = ['cache', 'ast', 'semantic', 'runtime', 'quality'] as const satisfies readonly IndexPatchPhase[]

function phaseRank(phase: IndexPatchPhase): number {
  return phaseOrder.indexOf(phase)
}

function fidelityRank(fidelity: ProjectDefinition['fidelity']): number {
  switch (fidelity) {
    case 'resolved':
      return 3
    case 'partial':
      return 2
    case 'error':
      return 1
    default:
      return 0
  }
}

function mergeMetadata(
  existing: ProjectDefinition['metadata'],
  incoming: ProjectDefinition['metadata'],
): ProjectDefinition['metadata'] {
  if (!existing) return incoming
  if (!incoming) return existing
  const metadata = { ...existing, ...incoming }
  const existingFacts = existing.facts
  const incomingFacts = incoming.facts
  if (isRecord(existingFacts) || isRecord(incomingFacts)) {
    const facts = {
      ...(isRecord(existingFacts) ? existingFacts : {}),
      ...(isRecord(incomingFacts) ? incomingFacts : {}),
    }
    const useEntries = [
      ...(isRecord(existingFacts) && Array.isArray(existingFacts.useEntries) ? existingFacts.useEntries : []),
      ...(isRecord(incomingFacts) && Array.isArray(incomingFacts.useEntries) ? incomingFacts.useEntries : []),
    ]
    if (useEntries.length > 0) facts.useEntries = useEntries
    metadata.facts = facts as NonNullable<ProjectDefinition['metadata']>['facts']
  }
  return metadata
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function mergeSourceRefs(
  existing: ProjectDefinition['sourceRefs'],
  incoming: ProjectDefinition['sourceRefs'],
): ProjectDefinition['sourceRefs'] {
  const refs = [...(existing ?? []), ...(incoming ?? [])]
  if (refs.length === 0) return undefined
  const merged = new Map<string, ProjectSourceRef>()
  for (const ref of refs) merged.set(ref.id, ref)
  return [...merged.values()]
}
