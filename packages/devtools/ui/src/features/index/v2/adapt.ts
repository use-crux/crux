/**
 * Index v2 — live `/api/index` adapter + indexes.
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
  IndexLintFinding,
  IndexLintSuppressedBy,
  IndexDiagnostic,
  ContractFacts,
  ControlFacts,
  DataFacts,
  DependencyFacts,
  DefinitionIntelligence,
  IndexedStorageCapabilities,
  InputSchemaContribution,
  JsonSchema,
  ProjectIndexData,
  ProjectDefinition,
  ProjectDefinitionMetadata,
  ProjectRelation,
  ProjectRuntimeJoin,
  ProjectSourceRef,
  SourceSnippet,
  WorkspaceDefinitionMount,
} from "@/types";
import type { EvalTimeoutPolicyProjection } from "@use-crux/core/project-index";
import { kindMeta, type FamilyId, type LintSeverity } from "./kit";
import {
  projectEffectCatalog,
  type EffectCatalogView,
} from "./effect-catalog";
/** Structural/containment relation types — a child rolls up under `from`. */
const CONTAINMENT_RE =
  /includes_case|includes_step|includes_route|includes_tier|includes_option|includes_block|includes_view|uses_store|storage\.bundle\.uses_(record|vector|asset)_store|storage\.scope\.wraps_storage/;

// ── schema field tree (JSON Schema → typed field nodes) ──────────────────────
export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  description?: string;
  fields?: SchemaField[];
}

function describeType(s: JsonSchema | undefined): string {
  if (!s) return "unknown";
  const t = s.type;
  if (Array.isArray(s.enum)) {
    const vals = s.enum
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join(" | ");
    return `enum<${vals}>`;
  }
  if (s.const !== undefined) return `const<${JSON.stringify(s.const)}>`;
  if (t === "array") {
    const items = s.items as JsonSchema | undefined;
    return `${items ? describeType(items) : "unknown"}[]`;
  }
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const variants = (s.anyOf ?? s.oneOf) as JsonSchema[];
    return variants.map(describeType).join(" | ");
  }
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return t.join(" | ");
  if (s.properties) return "object";
  return s.$ref ? String(s.$ref).split("/").pop()! : "unknown";
}

export function schemaToFields(schema: JsonSchema | undefined): SchemaField[] {
  if (!schema || typeof schema !== "object") return [];
  const props = schema.properties as Record<string, JsonSchema> | undefined;
  const required = (schema.required as string[] | undefined) ?? [];
  if (!props) return [];
  const out: SchemaField[] = [];
  for (const [name, sub] of Object.entries(props)) {
    let nested: SchemaField[] | undefined;
    if (sub.type === "object" && sub.properties) {
      nested = schemaToFields(sub);
    } else if (
      sub.type === "array" &&
      (sub.items as JsonSchema | undefined)?.type === "object"
    ) {
      nested = schemaToFields(sub.items as JsonSchema);
    }
    out.push({
      name,
      type: describeType(sub),
      required: required.includes(name),
      default: sub.default,
      description:
        typeof sub.description === "string" ? sub.description : undefined,
      fields: nested && nested.length > 0 ? nested : undefined,
    });
  }
  return out;
}

function fields(schema: JsonSchema | undefined): SchemaField[] | undefined {
  const f = schemaToFields(schema);
  return f.length > 0 ? f : undefined;
}

// ── facts (a permissive read view over the kind-specific facts union) ─────────
export interface IndexFacts {
  kind?: string;
  // prompt / context
  hasSystem?: boolean;
  hasMessages?: boolean;
  hasPrompt?: boolean;
  use?: string[];
  useEntries?: Array<{
    variable?: string;
    relationHint?:
      | "context"
      | "injectable"
      | "memory"
      | "blackboard"
      | "thread"
      | "unknown";
    targetDefinitionId?: string;
    targetKind?: string;
    targetName?: string;
    relationType?: string;
    relationFidelity?: string;
    conditionality?:
      | "always"
      | "when"
      | "match-case"
      | "match-default"
      | "binary-guard"
      | "dynamic"
      | "unknown";
    branch?: string;
    via?:
      | "direct"
      | "array-ref"
      | "spread"
      | "when"
      | "match"
      | "binary"
      | "runtime";
  }>;
  isStatic?: boolean;
  priority?: number;
  injectableId?: string;
  mayInject?: Array<
    "contexts" | "tools" | "constraints" | "guardrails" | "metadata"
  >;
  tools?: {
    hasTools: boolean;
    dynamic?: boolean;
    names?: string[];
    variables?: string[];
  };
  // tool
  toolName?: string;
  hasExecute?: boolean;
  hasToModelOutput?: boolean;
  approvalRequired?: boolean;
  serverId?: string;
  transport?:
    | { kind: "stdio"; executable?: string }
    | { kind: "streamable-http"; origin?: string; pathname?: string }
    | { kind: "resolver" };
  mcp?: {
    serverId: string;
    remoteName: string;
    exposedName: string;
    provenance: "authored-expected" | "runtime-discovered";
  };
  // effect / rag definition version
  effectId?: string;
  version?: string | number;
  recoverable?: boolean | "unknown";
  capture?: boolean | "unknown";
  resource?: boolean | "unknown";
  // agent
  promptId?: string;
  toolNames?: string[];
  handoffs?: string[];
  // flow / step
  runtime?: string;
  stepNames?: string[];
  targetDefinitionId?: string;
  targetVariable?: string;
  suspends?: boolean;
  // session
  operation?: "create" | "get";
  target?:
    | { kind: "agent" | "flow" | "unresolved" | "dynamic" }
    | { kind: "signal"; signalId: string };
  key?: { kind: "literal"; value: string } | { kind: "dynamic" };
  identity?: "static" | "partial";
  call?:
    | { kind: "supported" }
    | { kind: "ambiguous"; reason: "arity" | "options" };
  usage?: {
    subscribe?: true;
    stream?: true;
    stats?: true;
    close?: true;
    kill?: true;
    delete?: true;
    fork?: true;
    clone?: true;
  };
  subscriptions?: readonly {
    signalVariable?: string;
    signalDefinitionId?: string;
    matchKind: "bare" | "when" | "dynamic";
  }[];
  // signal provider / transport binding
  signalId?: string;
  providerId?: string;
  bindingId?: string;
  transportKind?: "webhook" | "polling" | "stream" | "sse";
  transportVariable?: string;
  signalIds?: string[];
  signalVariables?: string[];
  hasOnEvent?: boolean;
  providerVariable?: string;
  providerDefinitionId?: string;
  adapterId?: string;
  configRef?:
    | { kind: "literal"; id: string; revision: string }
    | { kind: "partial" }
    | { kind: "dynamic" };
  liveFields?: string[];
  // composition
  participants?: string[];
  coordinator?: string;
  judge?: string;
  sharedBlackboard?: string;
  // routing
  routeCount?: number;
  hasDefaultRoute?: boolean;
  hasClassify?: boolean;
  hasSeed?: boolean;
  attempts?: number;
  tierCount?: number;
  optionCount?: number;
  hasBudget?: boolean;
  budget?: { maxCostUsd?: number; [k: string]: unknown };
  routeKey?: string;
  weight?: number;
  targetIndex?: number;
  isDefault?: boolean;
  tierIndex?: number;
  hasEvaluate?: boolean;
  routingContextType?: string;
  routingContextRequired?: boolean;
  profile?: Record<string, unknown>;
  // rag
  knowledgeBaseId?: string;
  viewId?: string;
  whereFields?: readonly string[];
  relationId?: string;
  assertionId?: string;
  communitiesId?: string;
  modelName?: string;
  typeNames?: readonly string[];
  topK?: number;
  index?: number;
  rerankerId?: string;
  // memory / blackboard
  backend?: string;
  variableName?: string;
  blockCount?: number;
  evictionPolicy?: string;
  conflictPolicy?: string;
  blockKind?: string;
  // storage
  capabilities?: IndexedStorageCapabilities;
  records?: string;
  search?: string;
  assets?: string;
  storage?: string;
  prefix?: string;
  // workspace
  namespace?: string;
  mounts?: WorkspaceDefinitionMount[];
  hasTools?: boolean;
  // guardrail / constraint
  policy?: string;
  appliesTo?: string[];
  severity?: string;
  /** Ordered authored Safety boundaries; tuple order is significant. */
  boundaries?: string[];
  /** Compatibility primary boundary emitted beside `boundaries`. */
  boundary?: string;
  /** Static helper metadata safe for authored Catalog presentation. */
  strategy?: {
    kind?: string;
    config?: Record<string, unknown>;
  };
  // scorer
  model?: string;
  threshold?: number;
  scaleMin?: number;
  scaleMax?: number;
  hasRubric?: boolean;
  hasDetailSchema?: boolean;
  chainOfThought?: boolean;
  criteriaPreview?: string;
  caseCount?: number;
  scorerIds?: string[];
  timeout?: EvalTimeoutPolicyProjection;
  // config
  settings?: Record<string, unknown>;
}

export interface ContractView {
  inputSchema?: SchemaField[];
  expandedInputSchema?: SchemaField[];
  outputSchema?: SchemaField[];
  argsSchema?: SchemaField[];
  configSchema?: SchemaField[];
  schema?: SchemaField[];
  inputContributions?: InputSchemaContribution[];
}

export interface PresentationView {
  standalone: boolean;
  parentDefinitionId?: string;
  order?: number;
  role?: string;
}

// ── observed injection (the runtime/observed plane, laid over authored) ───────
// Composed from the observed-injection read model
// (`GET /api/project/index/observed-injection`), consumed per-definition. It is
// a *quiet annotation over authored truth* — authored (iris) stays primary;
// observed (crux + trace) rides along. Cautions baked in: `checked ≠ dropped`;
// `unobserved ≠ impossible`; counts depend on the trace window (always printed);
// drift evidence is intentionally NOT surfaced. KEY NAMES ONLY — values are
// never recorded (a privacy boundary of the read model).
export type InjectStateName =
  | "active"
  | "checked"
  | "dropped"
  | "disabled"
  | "unknown";

/** Per-resolution-state observed counts across the trace window. */
export type ObservedStateCounts = Partial<Record<InjectStateName, number>>;

/** One observed `match`/branch case vs the authored cases — a case with no
 *  recent trace is `seen: false` ("not seen"), never "dead". */
export interface ObservedBranch {
  label: string;
  seen: boolean;
  count?: number;
  isDefault?: boolean;
}

/** One authored dependency beside its observed resolution-state distribution. */
export interface ObservedSource {
  variable?: string;
  sourceDefinitionId?: string;
  sourceName?: string;
  sourceKind?: string;
  /** Authored conditionality this observation rides along (`InjectTag`). */
  conditionality?: string;
  states: ObservedStateCounts;
  branches?: ObservedBranch[];
  tools?: Array<{ name: string; count?: number }>;
}

/** The runtime input contract — the keys real calls passed vs the effective
 *  schema. KEY NAMES ONLY; values are never recorded. */
export interface ObservedRuntimeInput {
  provided?: string[];
  missingRequired?: string[];
  unexpected?: string[];
  /** 0..1 — validate pass rate over `validateCount` calls. */
  validatePassRate?: number;
  validateCount?: number;
}

export interface ObservedInjection {
  /** Human-readable trace window (e.g. "last 50 runs") — always printed. */
  window?: string;
  runCount?: number;
  input?: ObservedRuntimeInput;
  sources?: ObservedSource[];
}

// ── injectable "Contributes" (non-tool returns it folds in) ───────────────────
// constraints / guardrails / metadata, each tagged by how reliably Crux could
// resolve it: `static` (a literal), `spread` (a known spread), `dynamic`
// (computed at runtime — never guessed).
export type ContributeResolution = "static" | "spread" | "dynamic";

export interface ContributeItem {
  label: string;
  detail?: string;
  resolution: ContributeResolution;
}

export interface InjectableContributions {
  constraints?: ContributeItem[];
  guardrails?: ContributeItem[];
  metadata?: ContributeItem[];
}

/** The flattened shape every Index v2 component reads. */
export interface ViewDef {
  id: string;
  kind: string;
  name: string;
  description?: string;
  tags?: readonly string[];
  status?: string;
  fidelity: string;
  fingerprint?: string;
  path?: readonly string[];
  file?: string;
  line?: number;
  snippet?: SourceSnippet;
  sourceRefs?: ProjectSourceRef[];
  confidence: string;
  facts?: IndexFacts;
  /** Closed, authored-only Effect facts for Catalog presentation. */
  effectCatalog?: EffectCatalogView;
  /** Flattened config block for the Configuration section: prefers the
   *  structured `metadata.configuration`, falls back to `facts.settings` +
   *  `metadata.settings`. Scalars render as a grid; nested objects (e.g.
   *  `scale`, `settings`) render as labelled sub-groups. */
  config?: Record<string, unknown>;
  contract?: ContractView;
  control?: ControlFacts;
  data?: DataFacts;
  dependencies?: DependencyFacts;
  diagnostics?: DefinitionIntelligence["diagnostics"];
  /** Hard compiler diagnostics associated through definition or source-ref identity. */
  indexDiagnostics?: readonly IndexDiagnostic[];
  runtimeJoin?: ProjectRuntimeJoin;
  sourceStatus?: ProjectDefinitionMetadata["sourceStatus"];
  presentation?: PresentationView;
  /** Source-file mtime as a short relative string (no author — see backend). */
  updated?: string;
  /** Observed-injection layer (prompt/context/injectable) — drives the
   *  `observed` detail section. Undefined until traces exist. */
  observed?: ObservedInjection;
  /** Injectable "Contributes" — constraints/guardrails/metadata it folds in. */
  contributions?: InjectableContributions;
  /** lint rule ids whose primary target is this definition (hero warnings). */
  lint: string[];
  raw: ProjectDefinition;
}

/** Short relative-time label (e.g. "2d ago") from a Unix-ms timestamp. */
export function fmtAgo(ms?: number): string | undefined {
  if (ms == null || !Number.isFinite(ms)) return undefined;
  const diff = Date.now() - ms;
  if (diff < 0) return new Date(ms).toLocaleDateString();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Some kinds emit their facts at `metadata.*` (top level) rather than in
 * `metadata.facts.*` (a known indexer inconsistency — see
 * CATALOG_V2_BACKEND_FOLLOWUPS.md). Read view tolerates both: lift the known
 * top-level fields into the facts view when they're missing there.
 */
function enrichFacts(
  facts: IndexFacts | undefined,
  meta: ProjectDefinitionMetadata,
): IndexFacts | undefined {
  const metaRec = meta as Record<string, unknown>;
  const out: IndexFacts = { ...(facts ?? {}) };
  let touched = facts != null;
  if (out.appliesTo == null && Array.isArray(metaRec.appliesTo)) {
    out.appliesTo = (metaRec.appliesTo as unknown[]).filter(
      (x): x is string => typeof x === "string",
    );
    touched = true;
  }
  if (out.caseCount == null && typeof metaRec.caseCount === "number") {
    out.caseCount = metaRec.caseCount;
    touched = true;
  }
  if (out.model == null && typeof metaRec.model === "string") {
    out.model = metaRec.model;
    touched = true;
  }
  if (out.threshold == null && typeof metaRec.threshold === "number") {
    out.threshold = metaRec.threshold;
    touched = true;
  }
  if (out.scaleMin == null && typeof metaRec.scaleMin === "number") {
    out.scaleMin = metaRec.scaleMin;
    touched = true;
  }
  if (out.scaleMax == null && typeof metaRec.scaleMax === "number") {
    out.scaleMax = metaRec.scaleMax;
    touched = true;
  }
  if (out.hasRubric == null && typeof metaRec.hasRubric === "boolean") {
    out.hasRubric = metaRec.hasRubric;
    touched = true;
  }
  if (
    out.hasDetailSchema == null &&
    typeof metaRec.hasDetailSchema === "boolean"
  ) {
    out.hasDetailSchema = metaRec.hasDetailSchema;
    touched = true;
  }
  if (
    out.chainOfThought == null &&
    typeof metaRec.chainOfThought === "boolean"
  ) {
    out.chainOfThought = metaRec.chainOfThought;
    touched = true;
  }
  if (
    out.criteriaPreview == null &&
    typeof metaRec.criteriaPreview === "string"
  ) {
    out.criteriaPreview = metaRec.criteriaPreview;
    touched = true;
  }
  if (out.namespace == null && typeof metaRec.namespace === "string") {
    out.namespace = metaRec.namespace;
    touched = true;
  }
  if (out.mounts == null && Array.isArray(metaRec.mounts)) {
    out.mounts = metaRec.mounts.filter(isWorkspaceDefinitionMount);
    touched = true;
  }
  if (out.hasTools == null && typeof metaRec.hasTools === "boolean") {
    out.hasTools = metaRec.hasTools;
    touched = true;
  }
  return touched ? out : facts;
}

function isWorkspaceDefinitionMount(
  value: unknown,
): value is WorkspaceDefinitionMount {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { path?: unknown }).path === "string",
  );
}

/**
 * The Configuration section's source object. Prefer the backend's structured
 * `metadata.configuration` (model/threshold/temperature/samples/scale/…); fall
 * back to merging `facts.settings` and `metadata.settings` for kinds that don't
 * emit a `configuration` block.
 */
function buildConfig(
  meta: ProjectDefinitionMetadata,
  facts: IndexFacts | undefined,
): Record<string, unknown> | undefined {
  const metaRec = meta as Record<string, unknown>;
  const profile = routingProfile(metaRec.profile) ?? facts?.profile;
  const configuration = metaRec.configuration;
  if (
    configuration &&
    typeof configuration === "object" &&
    !Array.isArray(configuration)
  ) {
    const c = configuration as Record<string, unknown>;
    if (Object.keys(c).length > 0)
      return profile && c.profile === undefined ? { ...c, profile } : c;
  }
  const settings = metaRec.settings;
  const merged: Record<string, unknown> = {
    ...(facts?.settings ?? {}),
    ...(settings && typeof settings === "object" && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {}),
    ...(profile ? { profile } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function routingProfile(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function buildContract(
  meta: ProjectDefinitionMetadata,
  intel: DefinitionIntelligence | undefined,
): ContractView | undefined {
  const c: ContractFacts | undefined = intel?.contract;
  const view: ContractView = {
    inputSchema: fields(c?.inputSchema ?? meta.inputSchema),
    expandedInputSchema: fields(c?.expandedInputSchema),
    outputSchema: fields(c?.outputSchema ?? meta.outputSchema),
    argsSchema: fields(c?.argsSchema ?? meta.argsSchema),
    configSchema: fields(c?.configSchema ?? meta.configSchema),
    schema: fields(meta.schema),
    inputContributions:
      c?.inputContributions && c.inputContributions.length > 0
        ? c.inputContributions
        : undefined,
  };
  if (
    !view.inputSchema &&
    !view.expandedInputSchema &&
    !view.outputSchema &&
    !view.argsSchema &&
    !view.configSchema &&
    !view.schema &&
    !view.inputContributions
  ) {
    return undefined;
  }
  return view;
}

/** Strip the project root (and any leading slash) so source paths read as
 *  short, repo-relative paths (e.g. `src/rfp/prompts.ts`) instead of the
 *  absolute paths the read model carries. */
export function makeRelPath(
  root?: string,
): (file?: string) => string | undefined {
  return (file) => {
    if (!file) return file;
    if (root && file.startsWith(root))
      return file.slice(root.length).replace(/^[/\\]+/, "");
    return file;
  };
}

/**
 * Read the observed-injection layer when the read model carries it (the
 * backend attaches the per-definition projection at `metadata.observedInjection`
 * or `metadata.intelligence.observedInjection`). Shape is validated loosely —
 * an unknown/partial payload simply renders nothing, never throws. KEY NAMES
 * ONLY reach the view; the read model never records values.
 */
function readObserved(
  metaRec: Record<string, unknown>,
  intel: DefinitionIntelligence | undefined,
): ObservedInjection | undefined {
  const raw =
    metaRec.observedInjection ??
    (intel as Record<string, unknown> | undefined)?.observedInjection ??
    undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as ObservedInjection;
  const hasInput =
    o.input &&
    ((o.input.provided?.length ?? 0) +
      (o.input.missingRequired?.length ?? 0) +
      (o.input.unexpected?.length ?? 0) >
      0 ||
      o.input.validateCount != null);
  const hasSources = Array.isArray(o.sources) && o.sources.length > 0;
  return hasInput || hasSources ? o : undefined;
}

/** Read an injectable's "Contributes" projection (constraints/guardrails/metadata). */
function readContributions(
  kind: string,
  metaRec: Record<string, unknown>,
  intel: DefinitionIntelligence | undefined,
): InjectableContributions | undefined {
  if (kind !== "injectable") return undefined;
  const raw =
    metaRec.contributions ??
    (intel as Record<string, unknown> | undefined)?.contributes ??
    undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as InjectableContributions;
  const any =
    (c.constraints?.length ?? 0) +
      (c.guardrails?.length ?? 0) +
      (c.metadata?.length ?? 0) >
    0;
  return any ? c : undefined;
}

export function toViewDef(
  def: ProjectDefinition,
  lintRuleIds: ReadonlyMap<string, string[]>,
  relPath: (file?: string) => string | undefined,
  indexDiagnostics: readonly IndexDiagnostic[] = [],
): ViewDef {
  const meta = def.metadata ?? {};
  const intel = meta.intelligence;
  // facts is a kind-specific discriminated union; IndexFacts is a permissive
  // read view over it, so bridge through unknown.
  const facts = enrichFacts(
    meta.facts as unknown as IndexFacts | undefined,
    meta,
  );
  const pres = meta.indexPresentation;
  const metaRec = meta as Record<string, unknown>;
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
    confidence: intel?.confidence ?? meta.sourceStatus?.confidence ?? "static",
    facts,
    effectCatalog: projectEffectCatalog({
      id: def.id,
      kind: def.kind,
      name: def.name,
      facts,
      sourceRefs: def.sourceRefs,
      relPath,
    }),
    config: buildConfig(meta, facts),
    contract: buildContract(meta, intel),
    control: intel?.control,
    data: intel?.data,
    dependencies: intel?.dependencies,
    diagnostics: intel?.diagnostics,
    indexDiagnostics,
    runtimeJoin: meta.runtimeJoin ?? intel?.runtimeJoin,
    sourceStatus: meta.sourceStatus,
    presentation: pres
      ? {
          standalone: pres.standalone,
          parentDefinitionId: pres.parentDefinitionId,
          order: pres.order,
          role: pres.role,
        }
      : undefined,
    updated: fmtAgo(meta.updated?.lastEditedAtMs) ?? meta.updated?.lastEditedAt,
    observed: readObserved(metaRec, intel),
    contributions: readContributions(def.kind, metaRec, intel),
    lint: lintRuleIds.get(def.id) ?? [],
    raw: def,
  };
}

// ── lint view (adds a single-string `fix` over the fixes[] array) ────────────
export type LintView = IndexLintFinding & {
  /** First non-suppress fix description — the design's `finding.fix`. */
  fix: string;
};

function toLintView(f: IndexLintFinding): LintView {
  const primaryFix = f.fixes.find((x) => x.kind !== "suppress") ?? f.fixes[0];
  return { ...f, fix: primaryFix?.description ?? "" };
}

// ── health view (the §4 finding shape the Index Health surfaces render) ───────
// The redesigned Health surfaces (overview / screen, ported
// in `health.tsx`) render against a flattened, kind-resolved finding shape. We
// adapt the live `IndexLintFinding` once here so the components never reshape
// the projection. Fields the backend has not shipped yet (`requires`, the
// built-in/extension `source` axis) degrade gracefully — `source` defaults to
// `built-in`, `requires`/`extension` stay undefined and their tags simply don't
// render. See the Index health implementation handover §4 / §6.
export interface HealthEvidence {
  location: string;
  note: string;
  signal?: string;
}

export interface HealthPropagationPath {
  from: string;
  fromKind: string;
  rel: string;
  to: string;
  toKind: string;
}

export interface HealthFix {
  title?: string;
  description: string;
  kind: IndexLintFinding["fixes"][number]["kind"];
  command?: string;
  docsUrl?: string;
  suppression?: string;
}

export interface HealthFinding {
  id: string;
  ruleId: string;
  severity: LintSeverity;
  category: string;
  maturity: string;
  confidence: string;
  /** built-in (no marker) vs extension (`@scope·vN` badge). */
  source: "built-in" | "extension";
  extension?: { name: string; version?: string } | null;
  /** analysis tier the rule needs (`syntax`/`index`/`semantic`) — sparse. */
  requires?: string;
  title: string;
  message: string;
  rationale: string;
  /** The effective-input field an injection contract rule concerns — drives
   *  in-context anchoring on the prompt's effective-input card. */
  inputField?: string;
  evidence: HealthEvidence[];
  propagationPaths: HealthPropagationPath[];
  primaryDefinitionId?: string;
  /** Resolved kind of the target — `unknown` for orphan findings. */
  primaryKind: string;
  fix: string;
  fixes: HealthFix[];
  suppression?: IndexLintFinding["suppression"];
  suppressed?: boolean;
  suppressedBy?: IndexLintSuppressedBy | null;
  docsUrl?: string;
  sourceLoc?: IndexLintFinding["source"];
}

/** Rule descriptor derived from firing findings until the backend ships
 *  first-class descriptors for zero-finding rules too. */
export interface HealthRuleDescriptor {
  id: string;
  title: string;
  category: string;
  severity: LintSeverity;
  source: "built-in" | "extension";
  extension?: { name: string; version?: string } | null;
  enabled: boolean;
  findingCount: number;
}

/** Internal adapter rules — plumbing, never surfaced as authored-architecture
 *  checks (handover §9). */
const LINT_INTERNAL_RULE_IDS = new Set<string>(["crux.index-lints"]);

const SEV_ORDER: Record<LintSeverity, number> = {
  error: 3,
  warning: 2,
  info: 1,
};

function associateIndexDiagnostics(
  definitions: readonly ProjectDefinition[],
  diagnostics: readonly IndexDiagnostic[],
): ReadonlyMap<string, readonly IndexDiagnostic[]> {
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const sourceRefOwners = new Map<string, string | null>();

  for (const definition of definitions) {
    for (const sourceRef of definition.sourceRefs ?? []) {
      const existing = sourceRefOwners.get(sourceRef.id);
      sourceRefOwners.set(
        sourceRef.id,
        existing === undefined || existing === definition.id
          ? definition.id
          : null,
      );
    }
  }

  const associated = new Map<string, IndexDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const targets = new Set(
      (diagnostic.relatedDefinitionIds ?? []).filter((id) =>
        definitionIds.has(id),
      ),
    );
    if (diagnostic.evidence?.kind === "prompt-text") {
      const owner = sourceRefOwners.get(diagnostic.evidence.sourceRefId);
      if (owner) targets.add(owner);
    }
    for (const target of targets) {
      const current = associated.get(target) ?? [];
      current.push(diagnostic);
      associated.set(target, current);
    }
  }
  return associated;
}

// ── the index (replaces the design's INDEX_* module globals) ───────────────────
export interface IndexIndex {
  defs: ViewDef[];
  standalone: ViewDef[];
  relations: ProjectRelation[];
  indexing: ProjectIndexData["indexing"];
  projectRoot?: string;
  /** Repo-relative form of an absolute source path (strips `project.root`). */
  relPath: (file?: string) => string | undefined;
  byId: (id: string) => ViewDef | undefined;
  /** Resolve a reference (from facts) to a definition: exact id first, then by
   *  unique `name`, then by id suffix (`…:ref` / `….ref`). Returns undefined
   *  for genuinely external/built-in references not in the index. */
  resolve: (ref: string) => ViewDef | undefined;
  childrenOf: (id: string) => ViewDef[];
  /** Exact structural parent resolved from presentation or containment relations. */
  parentOf: (id: string) => string | undefined;
  relationsOf: (id: string) => {
    incoming: ProjectRelation[];
    outgoing: ProjectRelation[];
  };
  /** Findings on this definition directly + those reached via its deps.
   *  Excludes suppressed findings (drives browser row dots + grouping). */
  lintsForDef: (id: string) => LintView[];
  countByFamily: () => Record<string, number>;
  lintCount: number;
  relationCount: number;
  /** Every finding (incl. suppressed) as the §4 health view — for the
   *  Index-wide Health screen list. */
  healthFindings: HealthFinding[];
  /** Health-view findings reaching this definition (direct + via deps),
   *  including suppressed ones (rendered struck, never hidden). */
  healthForDef: (id: string) => HealthFinding[];
  /** Firing rules derived from the findings. Excludes internal adapter rules. */
  ruleDescriptors: HealthRuleDescriptor[];
}

export function buildIndex(index: ProjectIndexData): IndexIndex {
  const rawDefs = index.definitions ?? [];
  const relations = index.relations ?? [];
  const projectRoot = index.project?.root;
  const relPath = makeRelPath(projectRoot);
  // All findings (incl. suppressed) minus internal adapter rules; `findings`
  // is the unsuppressed subset that drives hero warnings + the lint count.
  const allFindings = (index.lintFindings ?? [])
    .filter((f) => !LINT_INTERNAL_RULE_IDS.has(f.ruleId))
    .map(toLintView);
  const findings = allFindings.filter((f) => !f.suppressed);
  const indexDiagnostics = associateIndexDiagnostics(
    rawDefs,
    index.diagnostics ?? [],
  );

  // ruleIds per primary definition (drives ViewDef.lint hero warnings).
  const lintRuleIds = new Map<string, string[]>();
  for (const f of findings) {
    if (!f.primaryDefinitionId) continue;
    const arr = lintRuleIds.get(f.primaryDefinitionId) ?? [];
    arr.push(f.ruleId);
    lintRuleIds.set(f.primaryDefinitionId, arr);
  }

  const defs = rawDefs.map((d) =>
    toViewDef(d, lintRuleIds, relPath, indexDiagnostics.get(d.id) ?? []),
  );
  const byIdMap = new Map(defs.map((d) => [d.id, d]));

  // Secondary lookup for references that use a bare name rather than the full
  // (possibly namespaced) id. Names can collide across kinds, so only keep
  // unambiguous entries; ambiguous names fall through to id-suffix matching.
  const byName = new Map<string, ViewDef | null>();
  for (const d of defs) {
    byName.set(d.name, byName.has(d.name) ? null : d);
  }
  const resolve = (ref: string): ViewDef | undefined => {
    const exact = byIdMap.get(ref);
    if (exact) return exact;
    const named = byName.get(ref);
    if (named) return named;
    // last resort: a unique id ending in `:ref` or `.ref` (e.g. `context:currentDate`).
    const suffixed = defs.filter(
      (d) => d.id.endsWith(`:${ref}`) || d.id.endsWith(`.${ref}`),
    );
    return suffixed.length === 1 ? suffixed[0] : undefined;
  };

  // Containment can be expressed two ways: `indexPresentation.parentDefinitionId`
  // (flow steps, routes, Eval Cases, …) or another structural relation.
  // Infer the parent from relations when presentation doesn't carry it, so child
  // kinds roll up under their parent instead of leaking to the top level.
  const inferredParent = new Map<string, string>();
  for (const r of relations) {
    if (CONTAINMENT_RE.test(r.type) && !inferredParent.has(r.to))
      inferredParent.set(r.to, r.from);
  }
  const parentOf = (d: ViewDef): string | undefined =>
    d.presentation?.parentDefinitionId ?? inferredParent.get(d.id);

  // A def is standalone unless presentation says otherwise, it's a registry child
  // kind (step/route/tier/case/block/…), or it has an inferred parent.
  const isStandalone = (d: ViewDef): boolean => {
    if (d.presentation?.standalone === false) return false;
    if (parentOf(d)) return false;
    return !kindMeta(d.kind).child;
  };
  const standalone = defs.filter(isStandalone);

  const childrenByParent = new Map<string, ViewDef[]>();
  for (const d of defs) {
    const parent = parentOf(d);
    if (!parent) continue;
    const arr = childrenByParent.get(parent) ?? [];
    arr.push(d);
    childrenByParent.set(parent, arr);
  }

  const outgoing = new Map<string, ProjectRelation[]>();
  const incoming = new Map<string, ProjectRelation[]>();
  for (const r of relations) {
    (outgoing.get(r.from) ?? outgoing.set(r.from, []).get(r.from)!).push(r);
    (incoming.get(r.to) ?? incoming.set(r.to, []).get(r.to)!).push(r);
  }

  // lint reach: primary + (related ∪ affected ∪ propagated). Built over ALL
  // findings (incl. suppressed) so the Health surfaces can render suppressed
  // ones struck; `lintsForDef` filters suppressed out for dots/grouping.
  const reach = new Map<string, LintView[]>();
  const addReach = (id: string, f: LintView) => {
    const arr = reach.get(id) ?? [];
    if (!arr.includes(f)) arr.push(f);
    reach.set(id, arr);
  };
  for (const f of allFindings) {
    const ids = new Set<string>();
    if (f.primaryDefinitionId) ids.add(f.primaryDefinitionId);
    f.relatedDefinitionIds?.forEach((id) => ids.add(id));
    f.affectedDefinitionIds?.forEach((id) => ids.add(id));
    f.propagatedDefinitionIds?.forEach((id) => ids.add(id));
    ids.forEach((id) => addReach(id, f));
  }

  // ── health view mapping (live finding → the §4 shape, kind-resolved) ──────
  const kindOf = (id?: string): string =>
    id ? (byIdMap.get(id)?.kind ?? "unknown") : "unknown";
  const evidenceLocation = (
    e: IndexLintFinding["evidence"][number],
  ): string => {
    if (e.source?.file)
      return `${relPath(e.source.file) ?? e.source.file}:${e.source.line}`;
    if (e.definitionId) return e.definitionId;
    return e.label;
  };
  const mkHealth = (f: LintView): HealthFinding => {
    const evidence: HealthEvidence[] = (f.evidence ?? []).map((e) => ({
      location: evidenceLocation(e),
      note: e.description ?? e.label,
      signal: e.kind,
    }));
    let propagationPaths: HealthPropagationPath[] = (
      f.propagationPaths ?? []
    ).map((p) => ({
      from: p.fromDefinitionId,
      fromKind: kindOf(p.fromDefinitionId),
      rel: p.relationTypes.length ? p.relationTypes.join(" · ") : "used_by",
      to: p.toDefinitionId,
      toKind: kindOf(p.toDefinitionId),
    }));
    // Fall back to affected ids when the backend hasn't shipped structured
    // paths yet, so propagation still renders.
    if (!propagationPaths.length && f.primaryDefinitionId) {
      const from = f.primaryDefinitionId;
      propagationPaths = (f.affectedDefinitionIds ?? [])
        .filter((id) => id !== from)
        .map((to) => ({
          from,
          fromKind: kindOf(from),
          rel: "used_by",
          to,
          toKind: kindOf(to),
        }));
    }
    return {
      id: f.id,
      ruleId: f.ruleId,
      severity: f.severity,
      category: f.category,
      maturity: f.maturity,
      confidence: f.confidence,
      source: "built-in",
      extension: null,
      requires: undefined,
      title: f.title,
      message: f.message,
      rationale: f.rationale,
      inputField: f.inputField,
      evidence,
      propagationPaths,
      primaryDefinitionId: f.primaryDefinitionId,
      primaryKind: kindOf(f.primaryDefinitionId),
      fix: f.fix,
      fixes: f.fixes,
      suppression: f.suppression,
      suppressed: f.suppressed,
      suppressedBy: f.suppressedBy ?? null,
      docsUrl: f.docsUrl,
      sourceLoc: f.source,
    };
  };
  const healthFindings = allFindings.map(mkHealth);
  const healthById = new Map(healthFindings.map((h) => [h.id, h]));

  // Firing-rule descriptors derived from the unsuppressed findings. Until the
  // backend ships descriptors for zero-finding rules too, the overview reports
  // rules *firing*, not rules *passing*.
  const ruleAcc = new Map<string, LintView[]>();
  for (const f of findings) {
    const arr = ruleAcc.get(f.ruleId) ?? [];
    arr.push(f);
    ruleAcc.set(f.ruleId, arr);
  }
  const ruleDescriptors: HealthRuleDescriptor[] = [...ruleAcc.entries()]
    .map(([id, items]) => {
      const worst = items.reduce<LintSeverity>(
        (acc, f) => (SEV_ORDER[f.severity] > SEV_ORDER[acc] ? f.severity : acc),
        "info",
      );
      return {
        id,
        title: items[0].title,
        category: items[0].category,
        severity: worst,
        source: "built-in" as const,
        extension: null,
        enabled: true,
        findingCount: items.length,
      };
    })
    .sort(
      (a, b) =>
        SEV_ORDER[b.severity] - SEV_ORDER[a.severity] ||
        b.findingCount - a.findingCount,
    );

  return {
    defs,
    standalone,
    relations,
    indexing: index.indexing,
    projectRoot,
    relPath,
    byId: (id) => byIdMap.get(id),
    resolve,
    childrenOf: (id) => childrenByParent.get(id) ?? [],
    parentOf: (id) => {
      const definition = byIdMap.get(id);
      return definition ? parentOf(definition) : undefined;
    },
    relationsOf: (id) => ({
      incoming: incoming.get(id) ?? [],
      outgoing: outgoing.get(id) ?? [],
    }),
    lintsForDef: (id) => (reach.get(id) ?? []).filter((f) => !f.suppressed),
    healthFindings,
    healthForDef: (id) =>
      (reach.get(id) ?? [])
        .map((f) => healthById.get(f.id))
        .filter((h): h is HealthFinding => Boolean(h)),
    ruleDescriptors,
    countByFamily: () => {
      const m: Record<string, number> = {};
      for (const d of defs) {
        const fam = (kindMeta(d.kind).family ?? "other") as FamilyId | "other";
        m[fam] = (m[fam] ?? 0) + 1;
      }
      return m;
    },
    lintCount: findings.length,
    relationCount: relations.length,
  };
}

// ── per-kind "at a glance" fact chips ────────────────────────────────────────
export function indexFactChips(def: ViewDef): Array<[string, string | number]> {
  const f = def.facts ?? {};
  const out: Array<[string, string | number]> = [];
  const push = (k: string, v: unknown) => {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    out.push([k, Array.isArray(v) ? v.length : (v as string | number)]);
  };
  switch (def.kind) {
    case "prompt":
      push("system", f.hasSystem ? "yes" : null);
      push("messages", f.hasMessages ? "yes" : null);
      push("uses", f.use);
      push(
        "conditional uses",
        f.useEntries?.filter(
          (entry) => entry.conditionality && entry.conditionality !== "always",
        ),
      );
      break;
    case "context":
      push(f.isStatic ? "static" : "dynamic", "✓");
      push("priority", f.priority);
      push("uses", f.useEntries);
      push("tools", f.tools?.names ?? f.tools?.variables);
      break;
    case "injectable":
      push("injects", f.mayInject);
      push("uses", f.useEntries);
      push("tools", f.tools?.names ?? f.tools?.variables);
      break;
    case "tool":
      push("name", f.toolName);
      push("execute", f.hasExecute ? "yes" : null);
      if (f.approvalRequired) push("approval", "required");
      break;
    case "effect":
      push("id", f.effectId ?? "dynamic");
      push("version", f.version);
      push(
        "recovery",
        f.recoverable === true
          ? "recoverable"
          : f.recoverable === false
            ? "irreversible"
            : "unknown",
      );
      push(
        "capture",
        f.capture === true
          ? "yes"
          : f.capture === false
            ? "no"
            : "unknown",
      );
      break;
    case "agent":
      push("prompt", f.promptId);
      push("tools", f.toolNames);
      push("handoffs", f.handoffs);
      break;
    case "flow":
      push("runtime", f.runtime);
      push("steps", f.stepNames);
      break;
    case "session":
      push("operation", f.operation);
      push("identity", f.identity);
      push("target", f.targetVariable ?? f.target?.kind);
      push("key", f.key?.kind);
      break;
    case "signal":
      push("signal", f.signalId);
      break;
    case "signal.provider":
      push("provider", f.providerId);
      push("identity", f.identity);
      push("transport", f.transportKind);
      break;
    case "signal.transportBinding":
      push("binding", f.bindingId);
      push("identity", f.identity);
      push("provider", f.providerId);
      push("signal", f.signalId);
      break;
    case "rag.knowledgeBase":
      push("id", f.knowledgeBaseId);
      push("namespace", f.namespace);
      break;
    case "rag.knowledgeBase.view":
      push("view", f.viewId);
      push("where", f.whereFields);
      break;
    case "knowledge.relation":
      push("id", f.relationId);
      push("version", f.version);
      push("types", f.typeNames);
      push("model", f.modelName);
      break;
    case "knowledge.assertions":
      push("id", f.assertionId);
      push("version", f.version);
      push("types", f.typeNames);
      push("model", f.modelName);
      break;
    case "knowledge.communities":
      push("id", f.communitiesId);
      push("model", f.modelName);
      break;
    case "knowledge.model":
      push("model", f.modelName);
      push("version", f.version);
      break;
    case "composition.swarm":
      push("participants", f.participants);
      push("coordinator", f.coordinator);
      break;
    case "composition.consensus":
      push("voters", f.participants);
      push("judge", f.judge ?? "—");
      break;
    case "composition.parallel":
    case "composition.pipeline":
      push("participants", f.participants);
      break;
    case "routing.router":
      push("routes", f.routeCount);
      push("default", f.hasDefaultRoute ? "yes" : "none");
      push("classify", f.hasClassify ? "yes" : null);
      break;
    case "routing.split":
      push("routes", f.routeCount);
      push("seed", f.hasSeed ? "yes" : null);
      break;
    case "routing.retry":
      push("attempts", f.attempts);
      break;
    case "routing.cascade":
      push("tiers", f.tierCount);
      if (f.hasBudget) push("budget", "$" + (f.budget && f.budget.maxCostUsd));
      break;
    case "routing.fallback":
      push("options", f.optionCount);
      break;
    case "rag.recipe":
    case "rag.pipeline":
    case "rag.retriever":
      push("topK", f.topK);
      break;
    case "memory":
      push("backend", f.backend);
      push("blocks", f.blockCount);
      push("eviction", f.evictionPolicy ?? "none");
      break;
    case "blackboard":
      push("backend", f.backend);
      push("conflict", f.conflictPolicy ?? "none");
      break;
    case "workspace":
      push("namespace", f.namespace);
      push("mounts", f.mounts);
      push("tools", f.hasTools ? "yes" : null);
      break;
    case "storage.recordStore":
      push("backend", f.backend);
      push("variable", f.variableName);
      push("ttl", f.capabilities?.record?.ttl);
      push("filter", f.capabilities?.record?.filter);
      break;
    case "storage.searchStore":
      push("backend", f.backend);
      push("variable", f.variableName);
      push(
        "dense",
        f.capabilities?.search?.legs?.dense === true
          ? "yes"
          : f.capabilities?.search?.legs?.dense,
      );
      push("filter", f.capabilities?.search?.filter);
      break;
    case "storage.assetStore":
      push("backend", f.backend);
      push("variable", f.variableName);
      break;
    case "storage.bundle":
      push("records", f.records);
      push("search", f.search);
      push("assets", f.assets);
      break;
    case "storage.scope":
      push("storage", f.storage);
      push("prefix", f.prefix);
      break;
    case "guardrail":
      push("policy", f.policy);
      push("applies to", f.appliesTo);
      push("boundaries", f.boundaries ?? (f.boundary ? [f.boundary] : []));
      push("strategy", f.strategy?.kind);
      push("action", f.strategy?.config?.action);
      break;
    case "constraint":
      push("policy", f.policy);
      push("severity", f.severity);
      push("boundaries", f.boundaries ?? (f.boundary ? [f.boundary] : []));
      push("strategy", f.strategy?.kind);
      break;
    case "scorer":
      push("model", f.model);
      push("threshold", f.threshold);
      push("scale min", f.scaleMin);
      push("scale max", f.scaleMax);
      push("rubric", f.hasRubric ? "yes" : null);
      push("detail schema", f.hasDetailSchema ? "yes" : null);
      push(
        "chain of thought",
        f.chainOfThought != null ? (f.chainOfThought ? "yes" : "no") : null,
      );
      break;
    case "eval":
      push("cases", f.caseCount);
      push("scorers", f.scorerIds);
      break;
    default:
      if (f.targetDefinitionId) push("covers", f.targetDefinitionId);
      if (f.scorerIds) push("scorers", f.scorerIds);
  }
  return out;
}
