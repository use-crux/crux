/**
 * Catalog v2 — live `/api/catalog` adapter + indexes.
 *
 * The design renders against a flattened `viewDef` shape (it hoists
 * `metadata.intelligence.*` and a few fields to the top level). The real
 * read model returns the nested `ProjectDefinition`. We adapt once here —
 * `toViewDef` — and build the indexes the components need (`byId`,
 * `standalone`, `childrenOf`, `relationsOf`, `countByFamily`,
 * `lintsForDef`), replacing the design's module-global mock helpers.
 *
 * Per the read-model contract: missing optional fields mean "not captured
 * yet", never an error. Sections render only when their data exists, so a
 * `partial` definition collapses to identity + hero + provenance.
 */

import type {
  CatalogLintFinding,
  ContractFacts,
  ControlFacts,
  DataFacts,
  DependencyFacts,
  DefinitionIntelligence,
  InputSchemaContribution,
  JsonSchema,
  ProjectCatalogData,
  ProjectDefinition,
  ProjectDefinitionMetadata,
  ProjectDefinitionQuality,
  ProjectRelation,
  ProjectRuntimeJoin,
  ProjectSourceRef,
  SourceSnippet,
} from '@/types'
import { kindMeta, type FamilyId } from './kit'

/** Structural/containment relation types — a child rolls up under `from`. */
const CONTAINMENT_RE = /includes_case|includes_step|includes_route|includes_tier|includes_option|includes_block|uses_store/

// ── schema field tree (JSON Schema → typed field nodes) ──────────────────────
export interface SchemaField {
  name: string
  type: string
  required: boolean
  default?: unknown
  description?: string
  fields?: SchemaField[]
}

function describeType(s: JsonSchema | undefined): string {
  if (!s) return 'unknown'
  const t = s.type
  if (Array.isArray(s.enum)) {
    const vals = s.enum.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' | ')
    return `enum<${vals}>`
  }
  if (s.const !== undefined) return `const<${JSON.stringify(s.const)}>`
  if (t === 'array') {
    const items = s.items as JsonSchema | undefined
    return `${items ? describeType(items) : 'unknown'}[]`
  }
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const variants = (s.anyOf ?? s.oneOf) as JsonSchema[]
    return variants.map(describeType).join(' | ')
  }
  if (typeof t === 'string') return t
  if (Array.isArray(t)) return t.join(' | ')
  if (s.properties) return 'object'
  return s.$ref ? String(s.$ref).split('/').pop()! : 'unknown'
}

export function schemaToFields(schema: JsonSchema | undefined): SchemaField[] {
  if (!schema || typeof schema !== 'object') return []
  const props = schema.properties as Record<string, JsonSchema> | undefined
  const required = (schema.required as string[] | undefined) ?? []
  if (!props) return []
  const out: SchemaField[] = []
  for (const [name, sub] of Object.entries(props)) {
    let nested: SchemaField[] | undefined
    if (sub.type === 'object' && sub.properties) {
      nested = schemaToFields(sub)
    } else if (sub.type === 'array' && (sub.items as JsonSchema | undefined)?.type === 'object') {
      nested = schemaToFields(sub.items as JsonSchema)
    }
    out.push({
      name,
      type: describeType(sub),
      required: required.includes(name),
      default: sub.default,
      description: typeof sub.description === 'string' ? sub.description : undefined,
      fields: nested && nested.length > 0 ? nested : undefined,
    })
  }
  return out
}

function fields(schema: JsonSchema | undefined): SchemaField[] | undefined {
  const f = schemaToFields(schema)
  return f.length > 0 ? f : undefined
}

// ── facts (a permissive read view over the kind-specific facts union) ─────────
export interface CatFacts {
  kind?: string
  // prompt / context
  hasSystem?: boolean
  hasMessages?: boolean
  hasPrompt?: boolean
  use?: string[]
  useEntries?: Array<{
    variable?: string
    relationHint?: 'context' | 'injectable' | 'memory' | 'blackboard' | 'unknown'
    conditionality?: 'always' | 'when' | 'match-case' | 'match-default' | 'binary-guard' | 'dynamic' | 'unknown'
    branch?: string
    via?: 'direct' | 'spread' | 'when' | 'match' | 'binary'
  }>
  isStatic?: boolean
  priority?: number
  injectableId?: string
  mayInject?: Array<'contexts' | 'tools' | 'constraints' | 'guardrails' | 'metadata'>
  tools?: {
    hasTools: boolean
    dynamic?: boolean
    names?: string[]
    variables?: string[]
  }
  // tool
  toolName?: string
  hasExecute?: boolean
  hasToModelOutput?: boolean
  approvalRequired?: boolean
  // agent
  promptId?: string
  toolNames?: string[]
  handoffs?: string[]
  // flow / step
  runtime?: string
  stepNames?: string[]
  targetDefinitionId?: string
  targetVariable?: string
  suspends?: boolean
  // composition
  participants?: string[]
  coordinator?: string
  judge?: string
  sharedBlackboard?: string
  // routing
  routeCount?: number
  hasDefaultRoute?: boolean
  hasClassify?: boolean
  tierCount?: number
  optionCount?: number
  hasBudget?: boolean
  budget?: { maxCostUsd?: number; [k: string]: unknown }
  routeKey?: string
  isDefault?: boolean
  tierIndex?: number
  hasEvaluate?: boolean
  // rag
  topK?: number
  // memory / blackboard
  backend?: string
  blockCount?: number
  evictionPolicy?: string
  conflictPolicy?: string
  blockKind?: string
  // workspace
  namespace?: string
  mounts?: Array<{ path: string; mode?: string }>
  hasTools?: boolean
  // guardrail / constraint
  policy?: string
  appliesTo?: string[]
  severity?: string
  // scorer
  model?: string
  threshold?: number
  scaleMin?: number
  scaleMax?: number
  hasRubric?: boolean
  hasDetailSchema?: boolean
  chainOfThought?: boolean
  criteriaPreview?: string
  // dataset / suite / eval
  caseCount?: number
  scorerIds?: string[]
  // config
  settings?: Record<string, unknown>
}

export interface ContractView {
  inputSchema?: SchemaField[]
  expandedInputSchema?: SchemaField[]
  outputSchema?: SchemaField[]
  argsSchema?: SchemaField[]
  configSchema?: SchemaField[]
  schema?: SchemaField[]
  inputContributions?: InputSchemaContribution[]
}

export interface PresentationView {
  standalone: boolean
  parentDefinitionId?: string
  order?: number
  role?: string
}

/** The flattened shape every Catalog v2 component reads. */
export interface ViewDef {
  id: string
  kind: string
  name: string
  description?: string
  tags?: readonly string[]
  status?: string
  fidelity: string
  fingerprint?: string
  path?: readonly string[]
  file?: string
  line?: number
  snippet?: SourceSnippet
  sourceRefs?: ProjectSourceRef[]
  confidence: string
  facts?: CatFacts
  /** Flattened config block for the Configuration section: prefers the
   *  structured `metadata.configuration`, falls back to `facts.settings` +
   *  `metadata.settings`. Scalars render as a grid; nested objects (e.g.
   *  `scale`, `settings`) render as labelled sub-groups. */
  config?: Record<string, unknown>
  contract?: ContractView
  control?: ControlFacts
  data?: DataFacts
  dependencies?: DependencyFacts
  diagnostics?: DefinitionIntelligence['diagnostics']
  runtimeJoin?: ProjectRuntimeJoin
  sourceStatus?: ProjectDefinitionMetadata['sourceStatus']
  presentation?: PresentationView
  quality?: ProjectDefinitionQuality
  changedSinceBaseline?: boolean
  /** Source-file mtime as a short relative string (no author — see backend). */
  updated?: string
  /** lint rule ids whose primary target is this definition (hero warnings). */
  lint: string[]
  raw: ProjectDefinition
}

/** Short relative-time label (e.g. "2d ago") from a Unix-ms timestamp. */
export function fmtAgo(ms?: number): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined
  const diff = Date.now() - ms
  if (diff < 0) return new Date(ms).toLocaleDateString()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/**
 * Some kinds emit their facts at `metadata.*` (top level) rather than in
 * `metadata.facts.*` (a known indexer inconsistency — see
 * CATALOG_V2_BACKEND_FOLLOWUPS.md). Read view tolerates both: lift the known
 * top-level fields into the facts view when they're missing there.
 */
function enrichFacts(facts: CatFacts | undefined, meta: ProjectDefinitionMetadata): CatFacts | undefined {
  const metaRec = meta as Record<string, unknown>
  const out: CatFacts = { ...(facts ?? {}) }
  let touched = facts != null
  if (out.appliesTo == null && Array.isArray(metaRec.appliesTo)) {
    out.appliesTo = (metaRec.appliesTo as unknown[]).filter((x): x is string => typeof x === 'string')
    touched = true
  }
  if (out.caseCount == null && typeof metaRec.caseCount === 'number') {
    out.caseCount = metaRec.caseCount
    touched = true
  }
  if (out.model == null && typeof metaRec.model === 'string') {
    out.model = metaRec.model
    touched = true
  }
  if (out.threshold == null && typeof metaRec.threshold === 'number') {
    out.threshold = metaRec.threshold
    touched = true
  }
  if (out.scaleMin == null && typeof metaRec.scaleMin === 'number') {
    out.scaleMin = metaRec.scaleMin
    touched = true
  }
  if (out.scaleMax == null && typeof metaRec.scaleMax === 'number') {
    out.scaleMax = metaRec.scaleMax
    touched = true
  }
  if (out.hasRubric == null && typeof metaRec.hasRubric === 'boolean') {
    out.hasRubric = metaRec.hasRubric
    touched = true
  }
  if (out.hasDetailSchema == null && typeof metaRec.hasDetailSchema === 'boolean') {
    out.hasDetailSchema = metaRec.hasDetailSchema
    touched = true
  }
  if (out.chainOfThought == null && typeof metaRec.chainOfThought === 'boolean') {
    out.chainOfThought = metaRec.chainOfThought
    touched = true
  }
  if (out.criteriaPreview == null && typeof metaRec.criteriaPreview === 'string') {
    out.criteriaPreview = metaRec.criteriaPreview
    touched = true
  }
  return touched ? out : facts
}

/**
 * The Configuration section's source object. Prefer the backend's structured
 * `metadata.configuration` (model/threshold/temperature/samples/scale/…); fall
 * back to merging `facts.settings` and `metadata.settings` for kinds that don't
 * emit a `configuration` block.
 */
function buildConfig(meta: ProjectDefinitionMetadata, facts: CatFacts | undefined): Record<string, unknown> | undefined {
  const metaRec = meta as Record<string, unknown>
  const configuration = metaRec.configuration
  if (configuration && typeof configuration === 'object' && !Array.isArray(configuration)) {
    const c = configuration as Record<string, unknown>
    if (Object.keys(c).length > 0) return c
  }
  const settings = metaRec.settings
  const merged: Record<string, unknown> = {
    ...(facts?.settings ?? {}),
    ...(settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}),
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

function buildContract(meta: ProjectDefinitionMetadata, intel: DefinitionIntelligence | undefined): ContractView | undefined {
  const c: ContractFacts | undefined = intel?.contract
  const view: ContractView = {
    inputSchema: fields(c?.inputSchema ?? meta.inputSchema),
    expandedInputSchema: fields(c?.expandedInputSchema),
    outputSchema: fields(c?.outputSchema ?? meta.outputSchema),
    argsSchema: fields(c?.argsSchema ?? meta.argsSchema),
    configSchema: fields(c?.configSchema ?? meta.configSchema),
    schema: fields(meta.schema),
    inputContributions: c?.inputContributions && c.inputContributions.length > 0 ? c.inputContributions : undefined,
  }
  if (
    !view.inputSchema &&
    !view.expandedInputSchema &&
    !view.outputSchema &&
    !view.argsSchema &&
    !view.configSchema &&
    !view.schema &&
    !view.inputContributions
  ) {
    return undefined
  }
  return view
}

/** Strip the project root (and any leading slash) so source paths read as
 *  short, repo-relative paths (e.g. `src/rfp/prompts.ts`) instead of the
 *  absolute paths the read model carries. */
export function makeRelPath(root?: string): (file?: string) => string | undefined {
  return (file) => {
    if (!file) return file
    if (root && file.startsWith(root)) return file.slice(root.length).replace(/^[/\\]+/, '')
    return file
  }
}

export function toViewDef(
  def: ProjectDefinition,
  lintRuleIds: ReadonlyMap<string, string[]>,
  relPath: (file?: string) => string | undefined,
): ViewDef {
  const meta = def.metadata ?? {}
  const intel = meta.intelligence
  // facts is a kind-specific discriminated union; CatFacts is a permissive
  // read view over it, so bridge through unknown.
  const facts = enrichFacts(meta.facts as unknown as CatFacts | undefined, meta)
  const pres = meta.catalogPresentation
  return {
    id: def.id,
    kind: def.kind,
    name: def.name,
    description: def.description,
    tags: def.tags,
    status: def.status,
    fidelity: def.fidelity,
    fingerprint: def.fingerprint,
    path: def.path,
    file: relPath(def.source?.file),
    line: def.source?.line,
    snippet: def.sourceSnippet,
    sourceRefs: def.sourceRefs,
    confidence: intel?.confidence ?? meta.sourceStatus?.confidence ?? 'static',
    facts,
    config: buildConfig(meta, facts),
    contract: buildContract(meta, intel),
    control: intel?.control,
    data: intel?.data,
    dependencies: intel?.dependencies,
    diagnostics: intel?.diagnostics,
    runtimeJoin: meta.runtimeJoin ?? intel?.runtimeJoin,
    sourceStatus: meta.sourceStatus,
    presentation: pres
      ? { standalone: pres.standalone, parentDefinitionId: pres.parentDefinitionId, order: pres.order, role: pres.role }
      : undefined,
    quality: def.quality,
    changedSinceBaseline: def.quality?.changedSinceBaseline,
    updated: fmtAgo(meta.updated?.lastEditedAtMs) ?? meta.updated?.lastEditedAt,
    lint: lintRuleIds.get(def.id) ?? [],
    raw: def,
  }
}

// ── lint view (adds a single-string `fix` over the fixes[] array) ────────────
export interface LintView extends CatalogLintFinding {
  /** First non-suppress fix description — the design's `finding.fix`. */
  fix: string
}

function toLintView(f: CatalogLintFinding): LintView {
  const primaryFix = f.fixes.find((x) => x.kind !== 'suppress') ?? f.fixes[0]
  return { ...f, fix: primaryFix?.description ?? '' }
}

// ── the index (replaces the design's CAT_* module globals) ───────────────────
export interface CatalogIndex {
  defs: ViewDef[]
  standalone: ViewDef[]
  relations: ProjectRelation[]
  indexing: ProjectCatalogData['indexing']
  projectRoot?: string
  /** Repo-relative form of an absolute source path (strips `project.root`). */
  relPath: (file?: string) => string | undefined
  byId: (id: string) => ViewDef | undefined
  /** Resolve a reference (from facts) to a definition: exact id first, then by
   *  unique `name`, then by id suffix (`…:ref` / `….ref`). Returns undefined
   *  for genuinely external/built-in references not in the catalog. */
  resolve: (ref: string) => ViewDef | undefined
  childrenOf: (id: string) => ViewDef[]
  relationsOf: (id: string) => { incoming: ProjectRelation[]; outgoing: ProjectRelation[] }
  /** Findings on this definition directly + those reached via its deps. */
  lintsForDef: (id: string) => LintView[]
  countByFamily: () => Record<string, number>
  lintCount: number
  relationCount: number
}

export function buildIndex(catalog: ProjectCatalogData): CatalogIndex {
  const rawDefs = catalog.definitions ?? []
  const relations = catalog.relations ?? []
  const projectRoot = catalog.project?.root
  const relPath = makeRelPath(projectRoot)
  const findings = (catalog.lintFindings ?? []).filter((f) => !f.suppressed).map(toLintView)

  // ruleIds per primary definition (drives ViewDef.lint hero warnings).
  const lintRuleIds = new Map<string, string[]>()
  for (const f of findings) {
    if (!f.primaryDefinitionId) continue
    const arr = lintRuleIds.get(f.primaryDefinitionId) ?? []
    arr.push(f.ruleId)
    lintRuleIds.set(f.primaryDefinitionId, arr)
  }

  const defs = rawDefs.map((d) => toViewDef(d, lintRuleIds, relPath))
  const byIdMap = new Map(defs.map((d) => [d.id, d]))

  // Secondary lookup for references that use a bare name rather than the full
  // (possibly namespaced) id. Names can collide across kinds, so only keep
  // unambiguous entries; ambiguous names fall through to id-suffix matching.
  const byName = new Map<string, ViewDef | null>()
  for (const d of defs) {
    byName.set(d.name, byName.has(d.name) ? null : d)
  }
  const resolve = (ref: string): ViewDef | undefined => {
    const exact = byIdMap.get(ref)
    if (exact) return exact
    const named = byName.get(ref)
    if (named) return named
    // last resort: a unique id ending in `:ref` or `.ref` (e.g. `context:currentDate`).
    const suffixed = defs.filter((d) => d.id.endsWith(`:${ref}`) || d.id.endsWith(`.${ref}`))
    return suffixed.length === 1 ? suffixed[0] : undefined
  }

  // Containment can be expressed two ways: `catalogPresentation.parentDefinitionId`
  // (flow steps, routes, …) OR a structural relation (e.g. `suite.includes_case`).
  // Infer the parent from relations when presentation doesn't carry it, so child
  // kinds roll up under their parent instead of leaking to the top level.
  const inferredParent = new Map<string, string>()
  for (const r of relations) {
    if (CONTAINMENT_RE.test(r.type) && !inferredParent.has(r.to)) inferredParent.set(r.to, r.from)
  }
  const parentOf = (d: ViewDef): string | undefined => d.presentation?.parentDefinitionId ?? inferredParent.get(d.id)

  // A def is standalone unless presentation says otherwise, it's a registry child
  // kind (step/route/tier/case/block/…), or it has an inferred parent.
  const isStandalone = (d: ViewDef): boolean => {
    if (d.presentation?.standalone === false) return false
    if (parentOf(d)) return false
    return !kindMeta(d.kind).child
  }
  const standalone = defs.filter(isStandalone)

  const childrenByParent = new Map<string, ViewDef[]>()
  for (const d of defs) {
    const parent = parentOf(d)
    if (!parent) continue
    const arr = childrenByParent.get(parent) ?? []
    arr.push(d)
    childrenByParent.set(parent, arr)
  }

  const outgoing = new Map<string, ProjectRelation[]>()
  const incoming = new Map<string, ProjectRelation[]>()
  for (const r of relations) {
    ;(outgoing.get(r.from) ?? outgoing.set(r.from, []).get(r.from)!).push(r)
    ;(incoming.get(r.to) ?? incoming.set(r.to, []).get(r.to)!).push(r)
  }

  // lint reach: primary + (related ∪ affected ∪ propagated).
  const reach = new Map<string, LintView[]>()
  const addReach = (id: string, f: LintView) => {
    const arr = reach.get(id) ?? []
    if (!arr.includes(f)) arr.push(f)
    reach.set(id, arr)
  }
  for (const f of findings) {
    const ids = new Set<string>()
    if (f.primaryDefinitionId) ids.add(f.primaryDefinitionId)
    f.relatedDefinitionIds?.forEach((id) => ids.add(id))
    f.affectedDefinitionIds?.forEach((id) => ids.add(id))
    f.propagatedDefinitionIds?.forEach((id) => ids.add(id))
    ids.forEach((id) => addReach(id, f))
  }

  return {
    defs,
    standalone,
    relations,
    indexing: catalog.indexing,
    projectRoot,
    relPath,
    byId: (id) => byIdMap.get(id),
    resolve,
    childrenOf: (id) => childrenByParent.get(id) ?? [],
    relationsOf: (id) => ({ incoming: incoming.get(id) ?? [], outgoing: outgoing.get(id) ?? [] }),
    lintsForDef: (id) => reach.get(id) ?? [],
    countByFamily: () => {
      const m: Record<string, number> = {}
      for (const d of defs) {
        const fam = (kindMeta(d.kind).family ?? 'other') as FamilyId | 'other'
        m[fam] = (m[fam] ?? 0) + 1
      }
      return m
    },
    lintCount: findings.length,
    relationCount: relations.length,
  }
}

// ── per-kind "at a glance" fact chips ────────────────────────────────────────
export function catFactChips(def: ViewDef): Array<[string, string | number]> {
  const f = def.facts ?? {}
  const out: Array<[string, string | number]> = []
  const push = (k: string, v: unknown) => {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return
    out.push([k, Array.isArray(v) ? v.length : (v as string | number)])
  }
  switch (def.kind) {
    case 'prompt':
      push('system', f.hasSystem ? 'yes' : null)
      push('messages', f.hasMessages ? 'yes' : null)
      push('uses', f.use)
      push('conditional uses', f.useEntries?.filter((entry) => entry.conditionality && entry.conditionality !== 'always'))
      break
    case 'context':
      push(f.isStatic ? 'static' : 'dynamic', '✓')
      push('priority', f.priority)
      push('uses', f.useEntries)
      push('tools', f.tools?.names ?? f.tools?.variables)
      break
    case 'injectable':
      push('injects', f.mayInject)
      push('uses', f.useEntries)
      push('tools', f.tools?.names ?? f.tools?.variables)
      break
    case 'tool':
      push('name', f.toolName)
      push('execute', f.hasExecute ? 'yes' : null)
      if (f.approvalRequired) push('approval', 'required')
      break
    case 'agent':
      push('prompt', f.promptId)
      push('tools', f.toolNames)
      push('handoffs', f.handoffs)
      break
    case 'flow':
      push('runtime', f.runtime)
      push('steps', f.stepNames)
      break
    case 'composition.swarm':
      push('participants', f.participants)
      push('coordinator', f.coordinator)
      break
    case 'composition.consensus':
      push('voters', f.participants)
      push('judge', f.judge ?? '—')
      break
    case 'composition.parallel':
    case 'composition.pipeline':
      push('participants', f.participants)
      break
    case 'routing.router':
      push('routes', f.routeCount)
      push('default', f.hasDefaultRoute ? 'yes' : 'none')
      push('classify', f.hasClassify ? 'yes' : null)
      break
    case 'routing.cascade':
      push('tiers', f.tierCount)
      if (f.hasBudget) push('budget', '$' + (f.budget && f.budget.maxCostUsd))
      break
    case 'routing.fallback':
      push('options', f.optionCount)
      break
    case 'rag.pipeline':
    case 'rag.retriever':
      push('topK', f.topK)
      break
    case 'memory':
      push('backend', f.backend)
      push('blocks', f.blockCount)
      push('eviction', f.evictionPolicy ?? 'none')
      break
    case 'blackboard':
      push('backend', f.backend)
      push('conflict', f.conflictPolicy ?? 'none')
      break
    case 'workspace':
      push('namespace', f.namespace)
      push('mounts', f.mounts)
      push('tools', f.hasTools ? 'yes' : null)
      break
    case 'guardrail':
      push('policy', f.policy)
      push('applies to', f.appliesTo)
      break
    case 'constraint':
      push('policy', f.policy)
      push('severity', f.severity)
      break
    case 'scorer':
      push('model', f.model)
      push('threshold', f.threshold)
      push('scale min', f.scaleMin)
      push('scale max', f.scaleMax)
      push('rubric', f.hasRubric ? 'yes' : null)
      push('detail schema', f.hasDetailSchema ? 'yes' : null)
      push('chain of thought', f.chainOfThought != null ? (f.chainOfThought ? 'yes' : 'no') : null)
      break
    case 'dataset':
      push('cases', f.caseCount)
      break
    case 'suite':
      push('cases', f.caseCount)
      push('scorers', f.scorerIds)
      break
    default:
      if (f.targetDefinitionId) push('covers', f.targetDefinitionId)
      if (f.scorerIds) push('scorers', f.scorerIds)
  }
  return out
}
