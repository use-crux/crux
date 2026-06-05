import type {
  CatalogLintEvidence,
  CatalogLintFinding,
  CatalogLintFix,
  CruxLintCategory,
  CruxLintConfidence,
  CruxLintMaturity,
  CruxLintProfile,
  SourceLocation,
} from '@crux/core/catalog'

export const catalogLintRuleIds = [
  'definition.missing_eval_coverage',
  'quality.missing_baseline',
  'agent.unobservable_handoff',
  'prompt.missing_input_schema',
  'prompt.missing_output_schema',
  'context.missing_input_schema',
  'flow.untyped_args',
  'tool.missing_input_schema',
  'tool.output_not_inspectable',
  'flow.suspension_without_coverage',
  'workspace.write_without_guardrail',
  'memory.long_lived_without_retention',
  'resource.write_without_read',
  'consensus.missing_judge',
  'shared_blackboard_without_policy',
  'routing.missing_stable_id',
  'routing.router_missing_default',
  'routing.unresolved_target',
  'routing.cascade_unreachable_tier',
] as const

export type CatalogLintRuleId = (typeof catalogLintRuleIds)[number]

export interface CatalogLintRule {
  readonly id: CatalogLintRuleId
  readonly severity: CatalogLintFinding['severity']
  readonly category: CruxLintCategory
  readonly maturity: CruxLintMaturity
  readonly confidence: CruxLintConfidence
  readonly profiles: readonly CruxLintProfile[]
  readonly title: string
  readonly rationale: string
  readonly impact?: string
  readonly docsSlug: string
  readonly fixes: readonly CatalogLintFix[]
  readonly suppression: {
    readonly supported: boolean
    readonly scope: 'next-line' | 'line' | 'file'
  }
}

const DOCS_BASE = '/docs/reference/crux-core/catalog-lints'

function defineCatalogLintRule<const T extends CatalogLintRule>(rule: T): T {
  return rule
}

export const catalogLintRules = {
  'definition.missing_eval_coverage': defineCatalogLintRule({
    id: 'definition.missing_eval_coverage',
    severity: 'info',
    category: 'evaluation',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Definition has no eval coverage',
    rationale:
      'Eval coverage lets you compare authored AI behavior against known cases and catch regressions before prompts, agents, flows, or pipelines drift.',
    impact: 'Uncovered definitions can regress silently when prompts, models, tools, or orchestration logic changes.',
    docsSlug: 'definition-missing-eval-coverage',
    fixes: [{
      title: 'Add eval coverage',
      description: 'Add a prompt, flow, RAG, or quality eval that covers this definition, or connect it to a suite so regressions can be detected.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'quality.missing_baseline': defineCatalogLintRule({
    id: 'quality.missing_baseline',
    severity: 'info',
    category: 'quality',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Quality target has no baseline',
    rationale:
      'A promoted baseline lets you compare future runs against known behavior and understand whether authored AI changes are regressions or improvements.',
    impact: 'Without a baseline, quality history is visible but drift and regression checks cannot anchor to a known good run.',
    docsSlug: 'quality-missing-baseline',
    fixes: [{
      title: 'Promote a baseline',
      description: 'Promote a trusted experiment or variant as the baseline for this definition so future changes can be compared.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'agent.unobservable_handoff': defineCatalogLintRule({
    id: 'agent.unobservable_handoff',
    severity: 'warning',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Agent handoff target is not catalog-visible',
    rationale:
      'Catalog-visible handoff targets let you inspect the handoff path, connect parent and delegated work, and trust the trace tree when agents transfer control.',
    impact: 'A handoff to an unindexed or missing agent can appear as an orphaned tool call, missing branch, or disconnected trace segment.',
    docsSlug: 'agent-unobservable-handoff',
    fixes: [{
      title: 'Make the handoff target visible',
      description: 'Define and export the target agent with a stable id, or update the handoff id so it points at a catalog-visible agent.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'tool.missing_input_schema': defineCatalogLintRule({
    id: 'tool.missing_input_schema',
    severity: 'info',
    category: 'contracts',
    maturity: 'stable',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Tool has no input schema',
    rationale:
      'Tool input schemas make model-emitted arguments inspectable, validateable, and easier for your team to debug across traces, evals, and generated devtools UI.',
    impact: 'Untyped tool calls are harder to validate, inspect, replay, and explain when an agent makes a bad call.',
    docsSlug: 'tool-missing-input-schema',
    fixes: [{
      title: 'Declare tool parameters',
      description: 'Add a Zod or JSON-schema-compatible input schema to the tool parameters so arguments are validated and inspectable.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.missing_input_schema': defineCatalogLintRule({
    id: 'prompt.missing_input_schema',
    severity: 'info',
    category: 'contracts',
    maturity: 'stable',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Prompt has no input schema',
    rationale:
      'Prompt input schemas are the TypeScript contract for prompt inputs, context joins, replay, eval cases, and devtools inspection.',
    impact: 'Untyped prompt inputs are harder to validate, replay, compare, and safely refactor as the prompt evolves.',
    docsSlug: 'prompt-missing-input-schema',
    fixes: [{
      title: 'Declare prompt input',
      description: 'Add an input schema to the prompt so calls, eval cases, and traces share one inspectable contract.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.missing_output_schema': defineCatalogLintRule({
    id: 'prompt.missing_output_schema',
    severity: 'info',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['strict'],
    title: 'Prompt has no output schema',
    rationale:
      'Prompt output schemas make generated objects inspectable and comparable, and let evals assert structured behavior instead of only text.',
    impact: 'Unstructured prompt outputs can make downstream code, replay, and regression checks depend on ad hoc parsing.',
    docsSlug: 'prompt-missing-output-schema',
    fixes: [{
      title: 'Declare prompt output',
      description: 'Add an output schema when this prompt is expected to produce structured data or feed downstream logic.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'context.missing_input_schema': defineCatalogLintRule({
    id: 'context.missing_input_schema',
    severity: 'info',
    category: 'contracts',
    maturity: 'stable',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Dynamic context has no resolved input schema',
    rationale:
      'Context input schemas make conditional and dynamic context injection explicit, inspectable, and type-safe across prompt composition.',
    impact: 'Dynamic context without a resolved input contract can hide missing fields until runtime and make context windows harder to debug.',
    docsSlug: 'context-missing-input-schema',
    fixes: [{
      title: 'Declare resolvable context input',
      description: 'Use an inline or import-safe schema for the context input so Crux can project the contract into the catalog.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'flow.untyped_args': defineCatalogLintRule({
    id: 'flow.untyped_args',
    severity: 'info',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Flow args are not inspectable',
    rationale:
      'Flow argument schemas document the durable or immediate entry contract and make flow starts, resumes, and eval cases inspectable.',
    impact: 'Untyped flow arguments can make resumed work and flow evals depend on undocumented input shapes.',
    docsSlug: 'flow-untyped-args',
    fixes: [{
      title: 'Declare flow args',
      description: 'Add an import-safe args schema or Convex validator object so Crux can project the flow input contract.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'tool.output_not_inspectable': defineCatalogLintRule({
    id: 'tool.output_not_inspectable',
    severity: 'info',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['strict'],
    title: 'Tool output is not model-inspectable',
    rationale:
      'A model-output adapter makes tool results explicit for traces, replay, and debugging the model intent-to-execution chain.',
    impact: 'Raw tool outputs can be hard to inspect or compare when the application result differs from what the model receives.',
    docsSlug: 'tool-output-not-inspectable',
    fixes: [{
      title: 'Declare model output mapping',
      description: 'Add a toModelOutput adapter when the tool result needs a stable, inspectable model-facing representation.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'flow.suspension_without_coverage': defineCatalogLintRule({
    id: 'flow.suspension_without_coverage',
    severity: 'warning',
    category: 'evaluation',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Suspending flow has no eval coverage',
    rationale:
      'Suspension paths cross time, approval, and runtime boundaries, so you need regression coverage for resume behavior and stale pending work.',
    impact: 'A broken suspend/resume path can strand user work or continue with stale state after approval.',
    docsSlug: 'flow-suspension-without-coverage',
    fixes: [{
      title: 'Cover suspend and resume',
      description: 'Add a flow eval that exercises the suspend/resume path, including the expected approval or signal.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'workspace.write_without_guardrail': defineCatalogLintRule({
    id: 'workspace.write_without_guardrail',
    severity: 'warning',
    category: 'safety',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Writable workspace has no guardrail',
    rationale:
      'Writable workspaces can mutate drafts, files, and artifacts; guardrails help you keep those mutations policy-checked, auditable, and observable.',
    impact: 'Unprotected workspace writes can damage user content or make file mutations difficult to audit after the fact.',
    docsSlug: 'workspace-write-without-guardrail',
    fixes: [{
      title: 'Attach a guardrail',
      description: 'Attach a guardrail to the workspace or its write/delete tools so mutations are inspectable and policy-checked.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'memory.long_lived_without_retention': defineCatalogLintRule({
    id: 'memory.long_lived_without_retention',
    severity: 'info',
    category: 'memory',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Long-lived memory has no retention policy',
    rationale:
      'Long-lived episodic and semantic memory can accumulate stale or sensitive facts; a retention policy makes lifetime and cleanup behavior explicit.',
    impact: 'Memory without a visible retention policy can silently grow, preserve stale context, or keep user data longer than intended.',
    docsSlug: 'memory-long-lived-without-retention',
    fixes: [{
      title: 'Declare memory retention',
      description: 'Add an eviction or retention policy to long-lived memory so cleanup behavior is inspectable.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'resource.write_without_read': defineCatalogLintRule({
    id: 'resource.write_without_read',
    severity: 'info',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'State resource is written but never read',
    rationale:
      'A memory, blackboard, or workspace that receives writes but has no visible read path can indicate unreachable context, forgotten state, or an output-only side effect that should be intentional.',
    impact: 'Written-but-unread state can make agents appear to remember or persist work that is never actually used by prompts, tools, flows, or later runs.',
    docsSlug: 'resource-write-without-read',
    fixes: [{
      title: 'Connect or document the read path',
      description: 'Add a catalog-visible read path for this resource, or suppress the rule with a reason when the write is intentionally output-only.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'consensus.missing_judge': defineCatalogLintRule({
    id: 'consensus.missing_judge',
    severity: 'info',
    category: 'composition',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Consensus has no visible judge or scorer',
    rationale:
      'Consensus compositions need an inspectable decision policy so users can understand why one answer, plan, or agent output won.',
    impact: 'Without a visible judge or scorer, consensus behavior can look arbitrary in traces and may be hard to test or tune.',
    docsSlug: 'consensus-missing-judge',
    fixes: [{
      title: 'Attach a judge or scorer',
      description: 'Add a catalog-visible judge agent or scorer to the consensus composition so the decision policy is inspectable.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  shared_blackboard_without_policy: defineCatalogLintRule({
    id: 'shared_blackboard_without_policy',
    severity: 'warning',
    category: 'memory',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Shared blackboard has no conflict policy',
    rationale:
      'Shared blackboards can receive writes from multiple agents; a conflict policy helps your team understand and debug merge behavior.',
    impact: 'Concurrent agent writes can overwrite or contradict each other without an explicit policy for resolving shared state.',
    docsSlug: 'shared-blackboard-without-policy',
    fixes: [{
      title: 'Declare a conflict policy',
      description: 'Declare a blackboard conflict policy, such as consensus, judge, or last-writer-wins, when multiple agents can write shared state.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.missing_stable_id': defineCatalogLintRule({
    id: 'routing.missing_stable_id',
    severity: 'info',
    category: 'composition',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Routing primitive has no stable id',
    rationale:
      'Stable routing ids let catalog definitions, route decision spans, and quality history join reliably even when variables or files are renamed.',
    impact: 'Routes can still be indexed from variable names, but runtime joins and historical comparisons are less durable across refactors.',
    docsSlug: 'routing-missing-stable-id',
    fixes: [{
      title: 'Add a routing id',
      description: 'Add id to router(), cascade(), or fallback() options so authored routing and runtime spans share a stable join key.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.router_missing_default': defineCatalogLintRule({
    id: 'routing.router_missing_default',
    severity: 'warning',
    category: 'composition',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Router has no default route',
    rationale:
      'Routers need an explicit default route so unknown classifier outputs remain observable and deterministic instead of failing or silently depending on adapter behavior.',
    impact: 'A classifier returning an unexpected key can produce confusing route decisions and incomplete route coverage in traces.',
    docsSlug: 'routing-router-missing-default',
    fixes: [{
      title: 'Add default route',
      description: 'Add a default entry to the router routes map and point it at the safest fallback model or policy.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.unresolved_target': defineCatalogLintRule({
    id: 'routing.unresolved_target',
    severity: 'info',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Routing target is not catalog-visible',
    rationale:
      'Route, tier, and fallback option targets should connect to catalog-visible agents, prompts, or nested routing primitives so users can inspect the authored decision graph.',
    impact: 'Unresolved route targets appear as plain model references, which limits architecture views, impact analysis, and runtime span joins.',
    docsSlug: 'routing-unresolved-target',
    fixes: [{
      title: 'Make target visible',
      description: 'Reference an exported Crux definition or routing primitive, or keep raw model targets intentional and suppress this rule with a reason.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.cascade_unreachable_tier': defineCatalogLintRule({
    id: 'routing.cascade_unreachable_tier',
    severity: 'warning',
    category: 'composition',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Cascade tier makes later tiers unreachable',
    rationale:
      'A cascade tier without an evaluator accepts by default, so any following tiers are never reached unless that tier throws.',
    impact: 'Expensive backup tiers may look configured but never run, making quality escalation and cost expectations misleading.',
    docsSlug: 'routing-cascade-unreachable-tier',
    fixes: [{
      title: 'Add evaluator or reorder tiers',
      description: 'Add evaluate to non-terminal tiers, or move unconditional accept tiers to the end of the cascade.',
      kind: 'manual',
    }],
    suppression: { supported: true, scope: 'next-line' },
  }),
} satisfies Record<CatalogLintRuleId, CatalogLintRule>

export function knownCatalogLintRuleId(value: string): value is CatalogLintRuleId {
  return Object.hasOwn(catalogLintRules, value)
}

export function catalogLintFinding(input: {
  readonly ruleId: CatalogLintRuleId
  readonly key: string
  readonly message: string
  readonly source?: SourceLocation
  readonly primaryDefinitionId?: string
  readonly relatedDefinitionIds: readonly string[]
  readonly evidence: readonly CatalogLintEvidence[]
  readonly fixes?: readonly CatalogLintFix[]
}): CatalogLintFinding {
  const rule = catalogLintRules[input.ruleId]
  const docsUrl = `${DOCS_BASE}/${rule.docsSlug}`
  const suppressionDirective = `// crux-lint-disable-next-line ${rule.id} -- reason`
  const affectedDefinitionIds = [
    ...new Set([...(input.primaryDefinitionId ? [input.primaryDefinitionId] : []), ...input.relatedDefinitionIds]),
  ]
  return {
    id: `lint:${input.ruleId}:${input.key.replace(/[^a-zA-Z0-9_.:-]+/g, '-')}`,
    severity: rule.severity,
    ruleId: rule.id,
    category: rule.category,
    maturity: rule.maturity,
    confidence: rule.confidence,
    profiles: [...rule.profiles],
    title: rule.title,
    message: input.message,
    rationale: rule.rationale,
    ...(rule.impact ? { impact: rule.impact } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.primaryDefinitionId ? { primaryDefinitionId: input.primaryDefinitionId } : {}),
    relatedDefinitionIds: [...input.relatedDefinitionIds],
    affectedDefinitionIds,
    evidence: [...input.evidence],
    fixes: [
      ...rule.fixes,
      ...(input.fixes ?? []),
      {
        title: 'Read rule docs',
        description: 'Open the rule documentation for examples, trade-offs, and suppression guidance.',
        kind: 'docs',
        docsUrl,
      },
      ...(rule.suppression.supported
        ? [{
            title: 'Suppress intentionally',
            description: 'Use a rule-specific source comment only when this finding is intentional and documented.',
            kind: 'suppress' as const,
            suppression: suppressionDirective,
          }]
        : []),
    ],
    docsUrl,
    suppression: {
      supported: rule.suppression.supported,
      directive: suppressionDirective,
      scope: rule.suppression.scope,
    },
  }
}
