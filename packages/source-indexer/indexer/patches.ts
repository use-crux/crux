import type {
  CatalogDiagnostic,
  CatalogLintFinding,
  ContextMeta,
  CruxLintConfig,
  CatalogSourceFile,
  ProjectCatalogIndexingStatus,
  ProjectCatalogSnapshot,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
  ProjectSourceRef,
  PromptMeta,
  ToolMeta,
} from '@crux/core/catalog'
import { resolvedRelationId } from './relation-registry'

export type CatalogPatchPhase = 'cache' | 'ast' | 'semantic' | 'runtime' | 'quality'
export type CatalogPatchStatus = 'ok' | 'partial' | 'degraded'

export interface CatalogSourceRefFact {
  readonly definitionId: string
  readonly ref: ProjectSourceRef
}

export interface CatalogPatchFacts {
  readonly prompts?: readonly PromptMeta[]
  readonly contexts?: readonly ContextMeta[]
  readonly tools?: readonly ToolMeta[]
  readonly lint?: CruxLintConfig
  readonly definitions?: readonly ProjectDefinition[]
  readonly relations?: readonly ProjectRelation[]
  readonly sourceRefs?: readonly CatalogSourceRefFact[]
  readonly diagnostics?: readonly CatalogDiagnostic[]
  readonly lintFindings?: readonly CatalogLintFinding[]
  readonly sources?: readonly CatalogSourceFile[]
  readonly sourceGraph?: ProjectCatalogSnapshot['sourceGraph']
}

export interface CatalogPatchBudget {
  readonly maxFiles?: number
  readonly maxDefinitions?: number
  readonly maxRelations?: number
  readonly maxSourceRefs?: number
  readonly maxDiagnostics?: number
  readonly maxLintFindings?: number
  readonly maxSources?: number
  readonly maxBytes?: number
}

type CatalogPatchBudgetMetric =
  | 'files'
  | 'definitions'
  | 'relations'
  | 'sourceRefs'
  | 'diagnostics'
  | 'lintFindings'
  | 'sources'
  | 'bytes'

interface CatalogPatchBudgetViolation {
  readonly metric: CatalogPatchBudgetMetric
  readonly actual: number
  readonly limit: number
}

export interface CatalogPatch {
  readonly schemaVersion: 1
  readonly phase: CatalogPatchPhase
  readonly project: ProjectIdentity
  readonly startedAt: string
  readonly finishedAt?: string
  readonly status: CatalogPatchStatus
  readonly indexing?: ProjectCatalogIndexingStatus
  readonly facts: CatalogPatchFacts
  readonly invalidates?: {
    readonly files?: readonly string[]
    readonly definitionIds?: readonly string[]
    readonly all?: boolean
  }
}

export function enforceCatalogPatchBudget(
  patch: CatalogPatch,
  budget: CatalogPatchBudget | undefined,
  usage: { readonly fileCount?: number } = {},
): CatalogPatch {
  const violations = catalogPatchBudgetViolations(patch, budget, usage)
  if (violations.length === 0) return patch

  return {
    ...patch,
    status: 'degraded',
    facts: {
      diagnostics: [catalogPatchBudgetDiagnostic(patch, violations)],
    },
  }
}

export interface CatalogPatchState {
  readonly project?: ProjectIdentity
  readonly indexedAt?: string
  readonly indexing?: ProjectCatalogIndexingStatus
  readonly sourceGraph?: ProjectCatalogSnapshot['sourceGraph']
  readonly prompts: readonly PromptMeta[]
  readonly contexts: readonly ContextMeta[]
  readonly tools: readonly ToolMeta[]
  readonly lint?: CruxLintConfig
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly lintFindings: readonly CatalogLintFinding[]
  readonly sources: readonly CatalogSourceFile[]
  readonly diagnosticsByPhase: Readonly<Partial<Record<CatalogPatchPhase, readonly CatalogDiagnostic[]>>>
  readonly definitionPhases: Readonly<Record<string, CatalogPatchPhase>>
  readonly relationPhases: Readonly<Record<string, CatalogPatchPhase>>
  readonly lintFindingPhases: Readonly<Record<string, CatalogPatchPhase>>
  readonly sourcePhases: Readonly<Record<string, CatalogPatchPhase>>
}

function catalogPatchBudgetViolations(
  patch: CatalogPatch,
  budget: CatalogPatchBudget | undefined,
  usage: { readonly fileCount?: number },
): CatalogPatchBudgetViolation[] {
  if (!budget) return []
  const violations: CatalogPatchBudgetViolation[] = []
  addViolation(violations, 'files', usage.fileCount ?? 0, budget.maxFiles)
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
  violations: CatalogPatchBudgetViolation[],
  metric: CatalogPatchBudgetMetric,
  actual: number,
  limit: number | undefined,
): void {
  if (limit !== undefined && actual > limit) violations.push({ metric, actual, limit })
}

function catalogPatchBudgetDiagnostic(
  patch: CatalogPatch,
  violations: readonly CatalogPatchBudgetViolation[],
): CatalogDiagnostic {
  const summary = violations.map((violation) => `${violation.metric} ${violation.actual}/${violation.limit}`).join(', ')
  return {
    id: `diagnostic:${patch.phase}:budget-exceeded`,
    severity: 'info',
    code: `catalog.${patch.phase}_budget_exceeded`,
    message: `Catalog ${patch.phase} patch exceeded its budget (${summary}); ${patch.phase} facts were skipped to keep indexing bounded.`,
    suggestedFix: 'Reduce project catalog complexity or wait for finer-grained semantic chunking before enabling richer enrichment.',
  }
}

export function emptyCatalogPatchState(): CatalogPatchState {
  return {
    prompts: [],
    contexts: [],
    tools: [],
    definitions: [],
    relations: [],
    diagnostics: [],
    lintFindings: [],
    sources: [],
    diagnosticsByPhase: {},
    definitionPhases: {},
    relationPhases: {},
    lintFindingPhases: {},
    sourcePhases: {},
  }
}

export function catalogPatchFromSnapshot(
  snapshot: ProjectCatalogSnapshot,
  phase: CatalogPatchPhase = 'ast',
  status: CatalogPatchStatus = 'ok',
): CatalogPatch {
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
      sources: snapshot.sources,
      sourceGraph: snapshot.sourceGraph,
    },
  }
}

export function applyCatalogPatch(state: CatalogPatchState, patch: CatalogPatch): CatalogPatchState {
  const base = patch.invalidates?.all ? emptyCatalogPatchState() : invalidateCatalogPatchState(state, patch)
  const prompts = patch.facts.prompts ? [...patch.facts.prompts] : base.prompts
  const contexts = patch.facts.contexts ? [...patch.facts.contexts] : base.contexts
  const tools = patch.facts.tools ? [...patch.facts.tools] : base.tools
  const definitions = mergeDefinitionsForPatch(base.definitions, base.definitionPhases, patch)
  const definitionPhases = updateFactPhases(base.definitionPhases, patch.phase, patch.facts.definitions?.map((fact) => fact.id))
  const definitionsWithRefs = applySourceRefFacts(definitions, patch.facts.sourceRefs)
  const relations = mergeFactsById(base.relations, base.relationPhases, patch.phase, patch.facts.relations, relationFactKey)
  const relationPhases = updateFactPhases(base.relationPhases, patch.phase, patch.facts.relations?.map(relationFactKey))
  const lintFindings = mergeFactsById(
    base.lintFindings,
    base.lintFindingPhases,
    patch.phase,
    patch.facts.lintFindings,
  )
  const lintFindingPhases = updateFactPhases(
    base.lintFindingPhases,
    patch.phase,
    patch.facts.lintFindings?.map((fact) => fact.id),
  )
  const sources = mergeSourcesForPatch(base.sources, base.sourcePhases, patch)
  const sourcePhases = updateFactPhases(base.sourcePhases, patch.phase, patch.facts.sources?.map((source) => source.file))
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
    definitions: definitionsWithRefs,
    relations,
    diagnostics: diagnosticsFromPhases(diagnosticsByPhase),
    lintFindings,
    sources,
    diagnosticsByPhase,
    definitionPhases,
    relationPhases,
    lintFindingPhases,
    sourcePhases,
  }
}

function mergeSourcesForPatch(
  existing: readonly CatalogSourceFile[],
  phases: Readonly<Record<string, CatalogPatchPhase>>,
  patch: CatalogPatch,
): CatalogSourceFile[] {
  const merged = new Map(existing.map((source) => [source.file, source]))
  if (!patch.facts.sources?.length) return [...merged.values()]

  for (const source of patch.facts.sources) {
    const current = merged.get(source.file)
    const currentPhase = phases[source.file] ?? 'cache'
    if (current && phaseRank(patch.phase) < phaseRank(currentPhase)) continue
    merged.set(source.file, current ? mergeCatalogSourceFile(current, source) : source)
  }
  return [...merged.values()]
}

function mergeCatalogSourceFile(existing: CatalogSourceFile, incoming: CatalogSourceFile): CatalogSourceFile {
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
  existing: CatalogSourceFile['status'],
  incoming: CatalogSourceFile['status'],
): CatalogSourceFile['status'] {
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
  existing: Readonly<Partial<Record<CatalogPatchPhase, readonly CatalogDiagnostic[]>>>,
  patch: CatalogPatch,
): Readonly<Partial<Record<CatalogPatchPhase, readonly CatalogDiagnostic[]>>> {
  if (!patch.facts.diagnostics) return existing
  const shouldMergePhase = patch.invalidates !== undefined && patch.invalidates.all !== true
  return {
    ...existing,
    [patch.phase]: shouldMergePhase
      ? mergeFactsById(existing[patch.phase] ?? [], {}, patch.phase, patch.facts.diagnostics)
      : patch.facts.diagnostics,
  }
}

function invalidateCatalogPatchState(state: CatalogPatchState, patch: CatalogPatch): CatalogPatchState {
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
          .filter((relation) => invalidatedDefinitionIds.has(relation.from) || invalidatedDefinitionIds.has(relation.to))
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
  diagnosticsByPhase: Readonly<Partial<Record<CatalogPatchPhase, readonly CatalogDiagnostic[]>>>,
  invalidatedFiles: ReadonlySet<string>,
  invalidatedDiagnosticIds: ReadonlySet<string>,
): Readonly<Partial<Record<CatalogPatchPhase, readonly CatalogDiagnostic[]>>> {
  const next: Partial<Record<CatalogPatchPhase, readonly CatalogDiagnostic[]>> = {}
  for (const phase of phaseOrder) {
    const diagnostics = diagnosticsByPhase[phase]
    if (!diagnostics) continue
    next[phase] = diagnostics.filter(
      (diagnostic) =>
        !invalidatedDiagnosticIds.has(diagnostic.id) &&
        !(diagnostic.source?.file && invalidatedFiles.has(diagnostic.source.file)),
    )
  }
  return next
}

function lintFindingReferencesDefinitions(
  finding: CatalogLintFinding,
  definitionIds: ReadonlySet<string>,
): boolean {
  return (
    (finding.primaryDefinitionId !== undefined && definitionIds.has(finding.primaryDefinitionId)) ||
    finding.relatedDefinitionIds.some((id) => definitionIds.has(id)) ||
    (finding.affectedDefinitionIds?.some((id) => definitionIds.has(id)) ?? false) ||
    finding.evidence.some((evidence) => evidence.definitionId !== undefined && definitionIds.has(evidence.definitionId)) ||
    (finding.propagatedDefinitionIds?.some((id) => definitionIds.has(id)) ?? false) ||
    (finding.propagationPaths?.some(
      (path) => definitionIds.has(path.fromDefinitionId) || definitionIds.has(path.toDefinitionId),
    ) ?? false)
  )
}

function filterRecordKeys<T>(
  record: Readonly<Record<string, T>>,
  removedKeys: ReadonlySet<string>,
): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !removedKeys.has(key)))
}

function mergeDefinitionsForPatch(
  existing: readonly ProjectDefinition[],
  phases: Readonly<Record<string, CatalogPatchPhase>>,
  patch: CatalogPatch,
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
  existingPhase: CatalogPatchPhase,
  incoming: ProjectDefinition,
  incomingPhase: CatalogPatchPhase,
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
      phaseRank(incomingPhase) >= phaseRank(existingPhase) && fidelityRank(incoming.fidelity) >= fidelityRank(existing.fidelity)
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
  sourceRefs: readonly CatalogSourceRefFact[] | undefined,
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
  phases: Readonly<Record<string, CatalogPatchPhase>>,
  phase: CatalogPatchPhase,
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

function relationFactKey(relation: ProjectRelation): string {
  return resolvedRelationId(relation.type, relation.from, relation.to)
}

function updateFactPhases(
  existing: Readonly<Record<string, CatalogPatchPhase>>,
  phase: CatalogPatchPhase,
  ids: readonly string[] | undefined,
): Record<string, CatalogPatchPhase> {
  if (!ids?.length) return { ...existing }
  const next = { ...existing }
  for (const id of ids) {
    const current = next[id]
    if (!current || phaseRank(phase) >= phaseRank(current)) next[id] = phase
  }
  return next
}

function diagnosticsFromPhases(
  diagnosticsByPhase: Readonly<Partial<Record<CatalogPatchPhase, readonly CatalogDiagnostic[]>>>,
): CatalogDiagnostic[] {
  return phaseOrder.flatMap((phase) => diagnosticsByPhase[phase] ?? [])
}

const phaseOrder = ['cache', 'ast', 'semantic', 'runtime', 'quality'] as const satisfies readonly CatalogPatchPhase[]

function phaseRank(phase: CatalogPatchPhase): number {
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
  return { ...existing, ...incoming }
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
