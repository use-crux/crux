import { IndexRuleManifestSchema } from '@crux/core/project-index'
import type {
  IndexLintEvidence,
  IndexLintFinding,
  IndexLintFix,
  IndexRuleDescriptor,
  IndexRuleManifest,
  CruxLintCategory,
  CruxLintConfidence,
  CruxLintMaturity,
  CruxLintProfile,
  SourceLocation,
} from '@crux/core/project-index'

export const indexLintRuleIds = [
  'definition.missing_eval_coverage',
  'quality.missing_baseline',
  'agent.unobservable_handoff',
  'prompt.missing_input_schema',
  'prompt.missing_output_schema',
  'prompt.hidden_required_input',
  'prompt.conflicting_injected_input',
  'prompt.conditional_required_input',
  'context.missing_input_schema',
  'injection.dynamic_dependency',
  'injection.dynamic_tools',
  'prompt.indirect_tool_surface',
  'injectable.unused',
  'context.unused',
  'injection.unresolved_target',
  'injection.deep_schema_chain',
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

export type IndexLintRuleId = (typeof indexLintRuleIds)[number]

export interface IndexLintRule {
  readonly id: IndexLintRuleId
  readonly manifest: IndexRuleManifest
  readonly severity: IndexLintFinding['severity']
  readonly category: CruxLintCategory
  readonly maturity: CruxLintMaturity
  readonly confidence: CruxLintConfidence
  readonly profiles: readonly CruxLintProfile[]
  readonly title: string
  readonly rationale: string
  readonly impact?: string
  readonly docsSlug: string
  readonly fixes: readonly IndexLintFix[]
  readonly suppression: {
    readonly supported: boolean
    readonly scope: 'next-line' | 'line' | 'file'
  }
}

const DOCS_BASE = '/docs/reference/crux-core/index-lints'

type IndexLintRuleManifestOverrides = Partial<
  Pick<IndexRuleManifest, 'phase' | 'requires' | 'fidelity' | 'schema' | 'defaultOptions' | 'budget'>
>

type IndexLintRuleInput = Omit<IndexLintRule, 'manifest'> & {
  readonly manifest?: IndexLintRuleManifestOverrides
}

/**
 * Preserves literal rule metadata while checking the rule descriptor shape.
 */
function defineIndexLintRule<const T extends IndexLintRuleInput>(rule: T): T & IndexLintRule {
  const docsUrl = `${DOCS_BASE}/${rule.docsSlug}`
  return {
    ...rule,
    manifest: {
      id: rule.id,
      docs: {
        description: rule.rationale,
        recommended: rule.profiles.includes('recommended'),
        url: docsUrl,
      },
      phase: rule.manifest?.phase ?? 'index',
      requires: rule.manifest?.requires ?? ['definitions', 'relations'],
      fidelity: rule.manifest?.fidelity ?? 'safe',
      defaultSeverity: rule.severity,
      ...(rule.manifest?.schema ? { schema: rule.manifest.schema } : {}),
      ...(rule.manifest?.defaultOptions !== undefined ? { defaultOptions: rule.manifest.defaultOptions } : {}),
      ...(rule.manifest?.budget ? { budget: rule.manifest.budget } : {}),
    },
  }
}

export const indexLintRules = {
  'definition.missing_eval_coverage': defineIndexLintRule({
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
    fixes: [
      {
        title: 'Add eval coverage',
        description:
          'Add a prompt, flow, RAG, or quality eval that covers this definition, or connect it to a suite so regressions can be detected.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'quality.missing_baseline': defineIndexLintRule({
    id: 'quality.missing_baseline',
    severity: 'info',
    category: 'quality',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Quality target has no baseline',
    rationale:
      'A promoted baseline lets you compare future runs against known behavior and understand whether authored AI changes are regressions or improvements.',
    impact:
      'Without a baseline, quality history is visible but drift and regression checks cannot anchor to a known good run.',
    docsSlug: 'quality-missing-baseline',
    fixes: [
      {
        title: 'Promote a baseline',
        description:
          'Promote a trusted experiment or variant as the baseline for this definition so future changes can be compared.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'agent.unobservable_handoff': defineIndexLintRule({
    id: 'agent.unobservable_handoff',
    severity: 'warning',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Agent handoff target is not index-visible',
    rationale:
      'Index-visible handoff targets let you inspect the handoff path, connect parent and delegated work, and trust the trace tree when agents transfer control.',
    impact:
      'A handoff to an unindexed or missing agent can appear as an orphaned tool call, missing branch, or disconnected trace segment.',
    docsSlug: 'agent-unobservable-handoff',
    fixes: [
      {
        title: 'Make the handoff target visible',
        description:
          'Define and export the target agent with a stable id, or update the handoff id so it points at a index-visible agent.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'tool.missing_input_schema': defineIndexLintRule({
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
    fixes: [
      {
        title: 'Declare tool parameters',
        description:
          'Add a Zod or JSON-schema-compatible input schema to the tool parameters so arguments are validated and inspectable.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.missing_input_schema': defineIndexLintRule({
    id: 'prompt.missing_input_schema',
    manifest: { requires: ['definitions', 'sources'] },
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
    fixes: [
      {
        title: 'Declare prompt input',
        description:
          'Add an input schema to the prompt so calls, eval cases, and traces share one inspectable contract.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.missing_output_schema': defineIndexLintRule({
    id: 'prompt.missing_output_schema',
    severity: 'info',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['strict'],
    title: 'Prompt has no output schema',
    rationale:
      'Prompt output schemas make generated objects inspectable and comparable, and let evals assert structured behavior instead of only text.',
    impact:
      'Unstructured prompt outputs can make downstream code, replay, and regression checks depend on ad hoc parsing.',
    docsSlug: 'prompt-missing-output-schema',
    fixes: [
      {
        title: 'Declare prompt output',
        description:
          'Add an output schema when this prompt is expected to produce structured data or feed downstream logic.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.hidden_required_input': defineIndexLintRule({
    id: 'prompt.hidden_required_input',
    severity: 'info',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Prompt has injected required input',
    rationale:
      'Injected contexts and injectables can make a prompt require fields that are not visible in the prompt authored input schema. Surfacing those fields keeps prompt calls, eval cases, and replay inputs honest.',
    impact:
      'Callers can miss a required field because the requirement is hidden behind prompt composition instead of declared on the prompt itself.',
    docsSlug: 'prompt-hidden-required-input',
    fixes: [
      {
        title: 'Make the requirement visible',
        description:
          'Either add the field to the prompt input schema, make the injected source optional, or document why the injected requirement is intentionally hidden.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.conflicting_injected_input': defineIndexLintRule({
    id: 'prompt.conflicting_injected_input',
    severity: 'warning',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Prompt has conflicting injected input',
    rationale:
      'When multiple injected sources contribute the same input field with obviously incompatible schemas, callers and eval cases cannot know which contract is authoritative.',
    impact:
      'Prompt calls can validate differently depending on composition order, and generated devtools or replay forms may show a misleading contract.',
    docsSlug: 'prompt-conflicting-injected-input',
    fixes: [
      {
        title: 'Align contributed schemas',
        description:
          'Rename one field, make the schemas compatible, or move the shared field into the prompt input schema so every injected source agrees on the contract.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.conditional_required_input': defineIndexLintRule({
    id: 'prompt.conditional_required_input',
    severity: 'info',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Prompt has conditionally required input',
    rationale:
      'A field required by an injected source becomes only conditionally required when the source is guarded by when, match, or runtime-dependent composition. The global prompt schema must keep it optional, but authors still need to know which branch needs it.',
    impact:
      'Eval cases and callers can miss branch-specific input unless the conditional requirement is visible in the Project Index.',
    docsSlug: 'prompt-conditional-required-input',
    fixes: [
      {
        title: 'Document the branch requirement',
        description:
          'Keep the global field optional, but document or model the branch where it is required. If the branch always runs, remove the conditional wrapper.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'context.missing_input_schema': defineIndexLintRule({
    id: 'context.missing_input_schema',
    severity: 'info',
    category: 'contracts',
    maturity: 'stable',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Dynamic context has no resolved input schema',
    rationale:
      'Context input schemas make conditional and dynamic context injection explicit, inspectable, and type-safe across prompt composition.',
    impact:
      'Dynamic context without a resolved input contract can hide missing fields until runtime and make context windows harder to debug.',
    docsSlug: 'context-missing-input-schema',
    fixes: [
      {
        title: 'Declare resolvable context input',
        description:
          'Use an inline or import-safe schema for the context input so Crux can project the contract into the index.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'injection.dynamic_dependency': defineIndexLintRule({
    id: 'injection.dynamic_dependency',
    severity: 'info',
    category: 'observability',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Injection dependency is runtime-dependent',
    rationale:
      'Runtime-dependent injection is allowed, but the Project Index cannot fully explain the prompt or context graph from source alone. Marking the dynamic edge makes that blind spot visible.',
    impact:
      'Devtools, eval coverage, and static linting may under-report the contexts, memory, or injectables that can affect this definition.',
    docsSlug: 'injection-dynamic-dependency',
    fixes: [
      {
        title: 'Declare static use when possible',
        description:
          'Move stable dependencies into a static use array or keep the dynamic path intentional and documented with a suppression reason.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'injection.dynamic_tools': defineIndexLintRule({
    id: 'injection.dynamic_tools',
    severity: 'info',
    category: 'observability',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Injected tools are runtime-dependent',
    rationale:
      'Contexts and injectables can contribute tools dynamically. That keeps authoring flexible, but it means the model-facing tool surface cannot be fully inspected from static source.',
    impact:
      'A prompt or context may gain tools that are absent from the static Project Index, making safety review, replay, and eval setup less precise.',
    docsSlug: 'injection-dynamic-tools',
    fixes: [
      {
        title: 'Expose stable tool names',
        description:
          'Prefer static tool maps or named tool contributors where possible. Suppress only when the runtime-selected tool set is intentional.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'prompt.indirect_tool_surface': defineIndexLintRule({
    id: 'prompt.indirect_tool_surface',
    severity: 'info',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['strict'],
    title: 'Prompt receives tools through injection',
    rationale:
      'Tools can enter a prompt through contexts and injectables rather than the prompt body itself. Surfacing that indirect tool surface makes safety review, eval setup, and replay easier to reason about.',
    impact:
      'Authors can miss model-facing tools because the prompt does not declare them directly, especially when the tool source is multiple injection hops away.',
    docsSlug: 'prompt-indirect-tool-surface',
    fixes: [
      {
        title: 'Review the indirect tool source',
        description:
          'Keep the indirect tool surface intentional, document the injected source, or move stable tools closer to the prompt when direct visibility matters.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'injectable.unused': defineIndexLintRule({
    id: 'injectable.unused',
    severity: 'info',
    category: 'composition',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['experimental'],
    title: 'Injectable is not used by the indexed graph',
    rationale:
      'An index-visible injectable that is never reached from any prompt, context, or injectable may be dead authoring surface or a dynamically consumed dependency the static graph cannot see.',
    impact:
      'Unused injectables can make prompt composition harder to scan and can hide stale schema or tool contracts.',
    docsSlug: 'injectable-unused',
    fixes: [
      {
        title: 'Use, remove, or suppress',
        description:
          'Wire the injectable into a static use path, remove it if it is stale, or suppress the finding when it is intentionally consumed dynamically or externally.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'context.unused': defineIndexLintRule({
    id: 'context.unused',
    severity: 'info',
    category: 'composition',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['experimental'],
    title: 'Context is not used by the indexed graph',
    rationale:
      'A context that is not reachable from any prompt, context, or injectable may be dead authoring surface or may only be selected through dynamic runtime composition.',
    impact:
      'Unused contexts can keep stale prompt text, schema requirements, or tool surfaces alive without clear consumers.',
    docsSlug: 'context-unused',
    fixes: [
      {
        title: 'Use, remove, or suppress',
        description:
          'Wire the context into a static use path, remove it if it is stale, or suppress the finding when dynamic or external composition is intentional.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'injection.unresolved_target': defineIndexLintRule({
    id: 'injection.unresolved_target',
    severity: 'warning',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Injection target is unresolved',
    rationale:
      'A static-looking use entry that cannot be resolved to an index-visible definition makes the injection graph incomplete and can hide schema, tools, memory, or prompt text.',
    impact:
      'Devtools and lints may under-report what affects the prompt or context because a visible use target could not be linked.',
    docsSlug: 'injection-unresolved-target',
    fixes: [
      {
        title: 'Make the target resolvable',
        description:
          'Export or inline the target definition, avoid opaque aliases for static use entries, or intentionally mark the dependency as dynamic.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'injection.deep_schema_chain': defineIndexLintRule({
    id: 'injection.deep_schema_chain',
    severity: 'info',
    category: 'composition',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['strict'],
    title: 'Injected input comes from a deep chain',
    rationale:
      'Deeply injected schema requirements are harder to discover from the prompt surface and harder to keep aligned with callers and eval cases.',
    impact:
      'A prompt can appear simple while relying on fields contributed several composition hops away, making refactors and replay setup more fragile.',
    docsSlug: 'injection-deep-schema-chain',
    fixes: [
      {
        title: 'Flatten or document the chain',
        description:
          'Move important input requirements closer to the prompt, reduce composition depth, or document why the deep injection path is intentional.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'flow.untyped_args': defineIndexLintRule({
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
    fixes: [
      {
        title: 'Declare flow args',
        description:
          'Add an import-safe args schema or Convex validator object so Crux can project the flow input contract.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'tool.output_not_inspectable': defineIndexLintRule({
    id: 'tool.output_not_inspectable',
    severity: 'info',
    category: 'contracts',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['strict'],
    title: 'Tool output is not model-inspectable',
    rationale:
      'A model-output adapter makes tool results explicit for traces, replay, and debugging the model intent-to-execution chain.',
    impact:
      'Raw tool outputs can be hard to inspect or compare when the application result differs from what the model receives.',
    docsSlug: 'tool-output-not-inspectable',
    fixes: [
      {
        title: 'Declare model output mapping',
        description:
          'Add a toModelOutput adapter when the tool result needs a stable, inspectable model-facing representation.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'flow.suspension_without_coverage': defineIndexLintRule({
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
    fixes: [
      {
        title: 'Cover suspend and resume',
        description:
          'Add a flow eval that exercises the suspend/resume path, including the expected approval or signal.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'workspace.write_without_guardrail': defineIndexLintRule({
    id: 'workspace.write_without_guardrail',
    severity: 'warning',
    category: 'safety',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Writable workspace has no guardrail',
    rationale:
      'Writable workspaces can mutate drafts, files, and artifacts; guardrails help you keep those mutations policy-checked, auditable, and observable.',
    impact:
      'Unprotected workspace writes can damage user content or make file mutations difficult to audit after the fact.',
    docsSlug: 'workspace-write-without-guardrail',
    fixes: [
      {
        title: 'Attach a guardrail',
        description:
          'Attach a guardrail to the workspace or its write/delete tools so mutations are inspectable and policy-checked.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'memory.long_lived_without_retention': defineIndexLintRule({
    id: 'memory.long_lived_without_retention',
    severity: 'info',
    category: 'memory',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Long-lived memory has no retention policy',
    rationale:
      'Long-lived episodic and semantic memory can accumulate stale or sensitive facts; a retention policy makes lifetime and cleanup behavior explicit.',
    impact:
      'Memory without a visible retention policy can silently grow, preserve stale context, or keep user data longer than intended.',
    docsSlug: 'memory-long-lived-without-retention',
    fixes: [
      {
        title: 'Declare memory retention',
        description: 'Add an eviction or retention policy to long-lived memory so cleanup behavior is inspectable.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'resource.write_without_read': defineIndexLintRule({
    id: 'resource.write_without_read',
    severity: 'info',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'State resource is written but never read',
    rationale:
      'A memory, blackboard, or workspace that receives writes but has no visible read path can indicate unreachable context, forgotten state, or an output-only side effect that should be intentional.',
    impact:
      'Written-but-unread state can make agents appear to remember or persist work that is never actually used by prompts, tools, flows, or later runs.',
    docsSlug: 'resource-write-without-read',
    fixes: [
      {
        title: 'Connect or document the read path',
        description:
          'Add a index-visible read path for this resource, or suppress the rule with a reason when the write is intentionally output-only.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'consensus.missing_judge': defineIndexLintRule({
    id: 'consensus.missing_judge',
    severity: 'info',
    category: 'composition',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Consensus has no visible judge or scorer',
    rationale:
      'Consensus compositions need an inspectable decision policy so users can understand why one answer, plan, or agent output won.',
    impact:
      'Without a visible judge or scorer, consensus behavior can look arbitrary in traces and may be hard to test or tune.',
    docsSlug: 'consensus-missing-judge',
    fixes: [
      {
        title: 'Attach a judge or scorer',
        description:
          'Add a index-visible judge agent or scorer to the consensus composition so the decision policy is inspectable.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  shared_blackboard_without_policy: defineIndexLintRule({
    id: 'shared_blackboard_without_policy',
    severity: 'warning',
    category: 'memory',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Shared blackboard has no conflict policy',
    rationale:
      'Shared blackboards can receive writes from multiple agents; a conflict policy helps your team understand and debug merge behavior.',
    impact:
      'Concurrent agent writes can overwrite or contradict each other without an explicit policy for resolving shared state.',
    docsSlug: 'shared-blackboard-without-policy',
    fixes: [
      {
        title: 'Declare a conflict policy',
        description:
          'Declare a blackboard conflict policy, such as consensus, judge, or last-writer-wins, when multiple agents can write shared state.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.missing_stable_id': defineIndexLintRule({
    id: 'routing.missing_stable_id',
    severity: 'info',
    category: 'composition',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Routing primitive has no stable id',
    rationale:
      'Stable routing ids let index definitions, route decision spans, and quality history join reliably even when variables or files are renamed.',
    impact:
      'Routes can still be indexed from variable names, but runtime joins and historical comparisons are less durable across refactors.',
    docsSlug: 'routing-missing-stable-id',
    fixes: [
      {
        title: 'Add a routing id',
        description:
          'Add id to router(), cascade(), or fallback() options so authored routing and runtime spans share a stable join key.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.router_missing_default': defineIndexLintRule({
    id: 'routing.router_missing_default',
    severity: 'warning',
    category: 'composition',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Router has no default route',
    rationale:
      'Routers need an explicit default route so unknown classifier outputs remain observable and deterministic instead of failing or silently depending on adapter behavior.',
    impact:
      'A classifier returning an unexpected key can produce confusing route decisions and incomplete route coverage in traces.',
    docsSlug: 'routing-router-missing-default',
    fixes: [
      {
        title: 'Add default route',
        description:
          'Add a default entry to the router routes map and point it at the safest fallback model or policy.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.unresolved_target': defineIndexLintRule({
    id: 'routing.unresolved_target',
    severity: 'info',
    category: 'observability',
    maturity: 'preview',
    confidence: 'medium',
    profiles: ['recommended', 'strict'],
    title: 'Routing target is not index-visible',
    rationale:
      'Route, tier, and fallback option targets should connect to index-visible agents, prompts, or nested routing primitives so users can inspect the authored decision graph.',
    impact:
      'Unresolved route targets appear as plain model references, which limits architecture views, impact analysis, and runtime span joins.',
    docsSlug: 'routing-unresolved-target',
    fixes: [
      {
        title: 'Make target visible',
        description:
          'Reference an exported Crux definition or routing primitive, or keep raw model targets intentional and suppress this rule with a reason.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
  'routing.cascade_unreachable_tier': defineIndexLintRule({
    id: 'routing.cascade_unreachable_tier',
    severity: 'warning',
    category: 'composition',
    maturity: 'preview',
    confidence: 'high',
    profiles: ['recommended', 'strict'],
    title: 'Cascade tier makes later tiers unreachable',
    rationale:
      'A cascade tier without an evaluator accepts by default, so any following tiers are never reached unless that tier throws.',
    impact:
      'Expensive backup tiers may look configured but never run, making quality escalation and cost expectations misleading.',
    docsSlug: 'routing-cascade-unreachable-tier',
    fixes: [
      {
        title: 'Add evaluator or reorder tiers',
        description:
          'Add evaluate to non-terminal tiers, or move unconditional accept tiers to the end of the cascade.',
        kind: 'manual',
      },
    ],
    suppression: { supported: true, scope: 'next-line' },
  }),
} satisfies Record<IndexLintRuleId, IndexLintRule>

/**
 * Validates built-in rule manifests before compiler construction proceeds.
 */
export function validateBuiltInIndexRuleManifests(): readonly string[] {
  return indexLintRuleIds.flatMap((ruleId) => {
    const result = IndexRuleManifestSchema.safeParse(indexLintRules[ruleId].manifest)
    if (result.success) return []
    return result.error.issues.map(
      (issue) => `${ruleId}: rule manifest is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    )
  })
}

/**
 * Returns public descriptors for all built-in index lint rules.
 */
export function builtInIndexRuleDescriptors(): readonly IndexRuleDescriptor[] {
  return indexLintRuleIds.map((ruleId) => {
    const rule = indexLintRules[ruleId]
    return {
      id: rule.id,
      source: 'builtin',
      severity: rule.severity,
      category: rule.category,
      maturity: rule.maturity,
      confidence: rule.confidence,
      profiles: [...rule.profiles],
      title: rule.title,
      description: rule.rationale,
      rationale: rule.rationale,
      impact: rule.impact,
      docsUrl: `${DOCS_BASE}/${rule.docsSlug}`,
      fixes: [...rule.fixes],
      suppression: {
        supported: rule.suppression.supported,
        scope: rule.suppression.scope,
        directive: `// crux-lint-disable-next-line ${rule.id} -- reason`,
      },
      phase: rule.manifest.phase,
      requires: [...rule.manifest.requires],
      fidelity: rule.manifest.fidelity,
      optionSchema: rule.manifest.schema,
      defaultOptions: rule.manifest.defaultOptions,
      budget: rule.manifest.budget,
    }
  })
}

/**
 * Narrows arbitrary strings to built-in lint rule ids.
 */
export function knownIndexLintRuleId(value: string): value is IndexLintRuleId {
  return Object.hasOwn(indexLintRules, value)
}

/**
 * Builds a normalized lint finding from rule metadata and finding-specific
 * evidence.
 */
export function indexLintFinding(input: {
  readonly ruleId: IndexLintRuleId
  readonly key: string
  readonly message: string
  readonly source?: SourceLocation
  readonly primaryDefinitionId?: string
  readonly relatedDefinitionIds: readonly string[]
  readonly evidence: readonly IndexLintEvidence[]
  readonly fixes?: readonly IndexLintFix[]
}): IndexLintFinding {
  const rule = indexLintRules[input.ruleId]
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
        ? [
            {
              title: 'Suppress intentionally',
              description: 'Use a rule-specific source comment only when this finding is intentional and documented.',
              kind: 'suppress' as const,
              suppression: suppressionDirective,
            },
          ]
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
