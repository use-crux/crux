import { describe, expect, it } from 'vitest'
import type { ProjectDefinition, ProjectRelation } from '@use-crux/core/project-index'
import { canonicalIndexPatchFactsJson } from '../contracts/parity'
import { applyIndexLintConfig } from '../indexer/lints/config'
import { indexLintFindings } from '../indexer/lints/findings'
import { builtInIndexRuleDescriptors, type IndexLintRuleId } from '../indexer/lints/rules'
import { finalizeStaticIndexFactsWithWorker } from '../testing/static-index-worker'

type LintProfile = 'recommended' | 'strict' | 'experimental'

interface LintParityCase {
  readonly name: string
  readonly profile: LintProfile
  readonly definitions: readonly ProjectDefinition[]
  readonly relations?: readonly ProjectRelation[]
  readonly expectedRuleIds: readonly IndexLintRuleId[]
}

describe('native built-in lint parity', () => {
  it.each(lintParityCases)('$name', async (testCase) => {
    const root = '/workspace/acme'
    const relations = testCase.relations ?? []
    const native = await finalizeStaticIndexFactsWithWorker({
      root,
      nativeFacts: [{ root, definitions: testCase.definitions, relations }],
      extensionFacts: [],
      lintConfig: { profile: testCase.profile },
    })
    const ts = {
      lintFindings: applyIndexLintConfig({
        config: { profile: testCase.profile },
        diagnostics: [],
        ruleDescriptors: builtInIndexRuleDescriptors(),
        findings: indexLintFindings({
          definitions: testCase.definitions,
          relations,
        }),
      }),
    }

    expect(canonicalIndexPatchFactsJson({ lintFindings: native.lintFindings ?? [] })).toBe(
      canonicalIndexPatchFactsJson(ts),
    )
    const nativeRuleIds = new Set((native.lintFindings ?? []).map((finding) => finding.ruleId))
    for (const ruleId of testCase.expectedRuleIds) {
      expect(nativeRuleIds.has(ruleId), `${testCase.name} should emit ${ruleId}`).toBe(true)
    }
  })
})

const lintParityCases = [
  {
    name: 'quality baseline findings',
    profile: 'recommended',
    definitions: [
      definition({
        id: 'unknown:writer',
        kind: 'unknown',
        name: 'writer',
        quality: {
          experimentIds: ['experiment:writer'],
          experimentCount: 1,
          passRate: 0.8,
          lastRunId: 'experiment:writer',
        },
      }),
    ],
    expectedRuleIds: ['quality.missing_baseline'],
  },
  {
    name: 'prompt contract and coverage findings',
    profile: 'strict',
    definitions: [definition({ id: 'prompt:writer', kind: 'prompt', name: 'writer' })],
    expectedRuleIds: [
      'definition.missing_eval_coverage',
      'prompt.missing_input_schema',
      'prompt.missing_output_schema',
    ],
  },
  {
    name: 'dynamic context input findings',
    profile: 'strict',
    definitions: [
      definition({
        id: 'context:brand',
        kind: 'context',
        name: 'brand',
        metadata: { isStatic: false },
      }),
    ],
    expectedRuleIds: ['context.missing_input_schema'],
  },
  {
    name: 'flow argument findings',
    profile: 'strict',
    definitions: [
      definition({
        id: 'flow:review',
        kind: 'flow',
        name: 'review',
        metadata: { hasArgs: true },
      }),
    ],
    expectedRuleIds: ['definition.missing_eval_coverage', 'flow.untyped_args'],
  },
  {
    name: 'flow suspension coverage findings',
    profile: 'strict',
    definitions: [
      definition({
        id: 'flow:approval',
        kind: 'flow',
        name: 'approval',
        metadata: {
          argsSchema: { type: 'object' },
          intelligence: { confidence: 'static', control: { suspensionPoints: [{ id: 'approval', label: 'approval' }] } },
        },
      }),
    ],
    expectedRuleIds: ['definition.missing_eval_coverage', 'flow.suspension_without_coverage'],
  },
  {
    name: 'tool contract findings',
    profile: 'strict',
    definitions: [
      definition({ id: 'tool:search', kind: 'tool', name: 'search' }),
      definition({
        id: 'tool:execute',
        kind: 'tool',
        name: 'execute',
        metadata: { inputSchema: { type: 'object' }, hasExecute: true },
      }),
    ],
    expectedRuleIds: ['tool.missing_input_schema', 'tool.output_not_inspectable'],
  },
  {
    name: 'workspace and memory state findings',
    profile: 'strict',
    definitions: [
      definition({
        id: 'workspace:drafts',
        kind: 'workspace',
        name: 'drafts',
        metadata: { mounts: [{ access: 'readwrite' }] },
      }),
      definition({
        id: 'memory:profile',
        kind: 'memory',
        name: 'profile',
        metadata: { blocks: [{ kind: 'facts' }] },
      }),
    ],
    expectedRuleIds: ['workspace.write_without_guardrail', 'memory.long_lived_without_retention'],
  },
  {
    name: 'composition relation findings',
    profile: 'strict',
    definitions: [
      definition({ id: 'composition.consensus:review', kind: 'composition.consensus', name: 'review' }),
      definition({ id: 'composition.swarm:team', kind: 'composition.swarm', name: 'team' }),
      definition({ id: 'blackboard:shared', kind: 'blackboard', name: 'shared' }),
    ],
    relations: [
      relation('swarm.uses_blackboard', 'composition.swarm:team', 'blackboard:shared'),
    ],
    expectedRuleIds: [
      'definition.missing_eval_coverage',
      'consensus.missing_judge',
      'shared_blackboard_without_policy',
    ],
  },
  {
    name: 'agent handoff and resource write findings',
    profile: 'strict',
    definitions: [
      definition({ id: 'agent:writer', kind: 'agent', name: 'writer' }),
      definition({
        id: 'memory:session',
        kind: 'memory',
        name: 'session',
        metadata: { evictionPolicy: 'session' },
      }),
    ],
    relations: [
      relation('agent.can_handoff_to', 'agent:writer', 'tool:missing'),
      relation('agent.writes_memory', 'agent:writer', 'memory:session'),
    ],
    expectedRuleIds: [
      'definition.missing_eval_coverage',
      'agent.unobservable_handoff',
      'resource.write_without_read',
    ],
  },
  {
    name: 'routing findings',
    profile: 'strict',
    definitions: [
      definition({
        id: 'routing.router:quality',
        kind: 'routing.router',
        name: 'quality',
        metadata: { hasDefaultRoute: false, routeKeys: ['fast'] },
      }),
      definition({
        id: 'routing.router.route:fast',
        kind: 'routing.router.route',
        name: 'fast',
        metadata: { targetVariable: 'fastModel' },
      }),
    ],
    expectedRuleIds: [
      'definition.missing_eval_coverage',
      'routing.missing_stable_id',
      'routing.router_missing_default',
      'routing.unresolved_target',
    ],
  },
  {
    name: 'cascade reachability findings',
    profile: 'strict',
    definitions: [
      definition({
        id: 'routing.cascade:quality',
        kind: 'routing.cascade',
        name: 'quality',
        metadata: { hasStableId: true },
      }),
      definition({
        id: 'routing.cascade.tier:cheap',
        kind: 'routing.cascade.tier',
        name: 'cheap',
        metadata: { cascadeDefinitionId: 'routing.cascade:quality', tierIndex: 0, hasEvaluate: false },
      }),
      definition({
        id: 'routing.cascade.tier:expensive',
        kind: 'routing.cascade.tier',
        name: 'expensive',
        metadata: { cascadeDefinitionId: 'routing.cascade:quality', tierIndex: 1, hasEvaluate: true },
      }),
    ],
    expectedRuleIds: ['definition.missing_eval_coverage', 'routing.cascade_unreachable_tier'],
  },
  {
    name: 'experimental unused injection findings',
    profile: 'experimental',
    definitions: [
      definition({ id: 'context:unused', kind: 'context', name: 'unused' }),
      definition({ id: 'injectable:unused', kind: 'injectable', name: 'unused' }),
    ],
    expectedRuleIds: ['context.unused', 'injectable.unused'],
  },
] satisfies readonly LintParityCase[]

function definition(input: Omit<ProjectDefinition, 'fidelity'> & { readonly fidelity?: ProjectDefinition['fidelity'] }): ProjectDefinition {
  return {
    fidelity: 'resolved',
    source: { file: `/workspace/acme/src/${input.id.replace(/[^a-z0-9]+/gi, '-')}.ts`, line: 1, column: 1 },
    ...input,
  }
}

function relation(type: string, from: string, to: string): ProjectRelation {
  return {
    id: `relation:${type}:${from}:${to}`,
    type,
    from,
    to,
    source: { file: '/workspace/acme/src/relations.ts', line: 1, column: 1 },
    fidelity: 'resolved',
  }
}
