import type {
  IndexLintFinding,
  InputSchemaContribution,
  JsonSchema,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
} from '@use-crux/core/project-index'
import {
  type InjectionReadModel,
  type InjectionToolContribution,
  buildAllInjectionReadModels,
  contributionSourceRequiresField,
  contractExpandedInputSchema,
  contractInputSchema,
  schemaProperties,
  schemaRequiredFields,
} from '../static/injection-read-model'
import { flowLintFindings } from './flow'
import { indexLintFinding } from './rules'
import {
  childDefinitionsByParent,
  compareFindings,
  contextRequiresInputSchema,
  coveredDefinitions,
  definitionEvidence,
  flowRequiresArgsSchema,
  hasArgsSchema,
  hasConflictPolicy,
  hasInputSchema,
  hasOutputSchema,
  hasRetentionPolicy,
  hasRoutingTargetSourceRef,
  hasSuspensionPoints,
  isRoutingChild,
  isStateResourceReadRelation,
  isStateResourceWriteRelation,
  longLivedMemoryBlocks,
  memoryIsLongLived,
  propagateFindings,
  relationEvidence,
  relationSources,
  relationsBySource,
  routingChildHasUnresolvedTarget,
  routingTargetVariable,
  schemaSourceEvidence,
  shouldRequireCoverage,
  isRoutingRoot,
  stateResourceLabel,
  suspensionPointLabels,
  targetsByRelation,
  toolOutputNeedsAdapter,
  workspaceAllowsWrites,
} from './finding-helpers'
import { qualityMissingBaselineFinding } from './quality'

/**
 * Evaluates all built-in index lint findings over resolved definitions and
 * relations.
 */
export function indexLintFindings(input: {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}): IndexLintFinding[] {
  const byId = new Map(input.definitions.map((definition) => [definition.id, definition]))
  const injectionModels = buildAllInjectionReadModels(input)
  const coveredDefinitionIds = coveredDefinitions(input.definitions, input.relations)
  const guardrailTargets = targetsByRelation(input.relations, 'guardrail.applies_to')
  const consensusDecisionPolicies = relationSources(input.relations, ['consensus.uses_judge', 'consensus.uses_scorer'])
  const outgoingRelations = relationsBySource(input.relations)
  const injectionConsumers = injectionConsumedDefinitionIds(input.relations)
  const cascadeTiersByParent = childDefinitionsByParent(
    input.definitions,
    'routing.cascade.tier',
    'cascadeDefinitionId',
  )
  const findings: IndexLintFinding[] = []

  for (const definition of input.definitions) {
    findings.push(...flowLintFindings(definition))

    if (definition.kind === 'prompt' && !hasInputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'prompt.missing_input_schema',
          key: definition.id,
          message: `Prompt "${definition.name}" does not expose an input schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Prompt definition has no input schema'),
            ...schemaSourceEvidence(definition, 'input', 'Unresolved input schema source'),
          ],
        }),
      )
    }

    if (definition.kind === 'prompt' && !hasOutputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'prompt.missing_output_schema',
          key: definition.id,
          message: `Prompt "${definition.name}" does not expose an output schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Prompt definition has no output schema'),
            ...schemaSourceEvidence(definition, 'output', 'Unresolved output schema source'),
          ],
        }),
      )
    }

    if (definition.kind === 'prompt') {
      const model = injectionModels.get(definition.id)
      if (model) {
        findings.push(
          ...hiddenRequiredInputFindings(definition, model.inputContributions, byId),
          ...conflictingInjectedInputFindings(definition, model.inputContributions, byId),
          ...conditionalRequiredInputFindings(definition, model.inputContributions, byId),
          ...indirectToolSurfaceFindings(definition, model, byId),
          ...deepSchemaChainFindings(definition, model.inputContributions, byId),
        )
      }
    }

    if (definition.kind === 'context' && contextRequiresInputSchema(definition) && !hasInputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'context.missing_input_schema',
          key: definition.id,
          message: `Dynamic context "${definition.name}" does not expose a resolved input schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Dynamic context has no resolved input schema'),
            ...schemaSourceEvidence(definition, 'input', 'Unresolved input schema source'),
          ],
        }),
      )
    }

    if (definition.kind === 'flow' && flowRequiresArgsSchema(definition) && !hasArgsSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'flow.untyped_args',
          key: definition.id,
          message: `Flow "${definition.name}" declares args that Crux cannot project as a schema.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Flow has args but no projected args schema')],
        }),
      )
    }

    if (shouldRequireCoverage(definition) && !coveredDefinitionIds.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'definition.missing_eval_coverage',
          key: definition.id,
          message: `${definition.kind} "${definition.name}" is not covered by an eval relation or index quality join.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Definition without eval coverage')],
        }),
      )
    }

    const qualityFinding = qualityMissingBaselineFinding(definition)
    if (qualityFinding) findings.push(qualityFinding)

    if (definition.kind === 'tool' && !hasInputSchema(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'tool.missing_input_schema',
          key: definition.id,
          message: `Tool "${definition.name}" does not expose an input schema in the index.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Tool definition has no input schema')],
        }),
      )
    }

    if (definition.kind === 'tool' && toolOutputNeedsAdapter(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'tool.output_not_inspectable',
          key: definition.id,
          message: `Tool "${definition.name}" executes code but does not expose a model-output adapter.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Executable tool has no model-output adapter')],
        }),
      )
    }

    if (definition.kind === 'flow' && hasSuspensionPoints(definition) && !coveredDefinitionIds.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'flow.suspension_without_coverage',
          key: definition.id,
          message: `Flow "${definition.name}" has suspension points but no eval coverage.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Flow has suspension points'),
            {
              kind: 'definition',
              label: 'Suspension points',
              definitionId: definition.id,
              source: definition.source,
              data: { suspensionPoints: suspensionPointLabels(definition) },
            },
          ],
        }),
      )
    }

    if (definition.kind === 'workspace' && workspaceAllowsWrites(definition) && !guardrailTargets.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'workspace.write_without_guardrail',
          key: definition.id,
          message: `Workspace "${definition.name}" exposes write-capable access without a guardrail relation.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Writable workspace has no guardrail relation')],
        }),
      )
    }

    if (definition.kind === 'memory' && memoryIsLongLived(definition) && !hasRetentionPolicy(definition)) {
      findings.push(
        indexLintFinding({
          ruleId: 'memory.long_lived_without_retention',
          key: definition.id,
          message: `Memory "${definition.name}" has long-lived blocks but no visible retention policy.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Long-lived memory has no retention policy'),
            {
              kind: 'definition',
              label: 'Long-lived blocks',
              definitionId: definition.id,
              source: definition.source,
              data: { blocks: longLivedMemoryBlocks(definition) },
            },
          ],
        }),
      )
    }

    if (definition.kind === 'composition.consensus' && !consensusDecisionPolicies.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'consensus.missing_judge',
          key: definition.id,
          message: `Consensus "${definition.name}" has no visible judge or scorer.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Consensus has no visible judge or scorer')],
        }),
      )
    }

    if (isRoutingRoot(definition) && definition.metadata?.hasStableId !== true) {
      findings.push(
        indexLintFinding({
          ruleId: 'routing.missing_stable_id',
          key: definition.id,
          message: `${definition.kind} "${definition.name}" uses an indexer fallback id instead of an authored stable id.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Routing primitive has no authored stable id')],
        }),
      )
    }

    if (definition.kind === 'routing.router' && definition.metadata?.hasDefaultRoute !== true) {
      findings.push(
        indexLintFinding({
          ruleId: 'routing.router_missing_default',
          key: definition.id,
          message: `Router "${definition.name}" does not declare a default route.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [
            definitionEvidence(definition, 'Router route map has no default key'),
            {
              kind: 'definition',
              label: 'Route keys',
              definitionId: definition.id,
              source: definition.source,
              data: { routeKeys: definition.metadata?.routeKeys },
            },
          ],
        }),
      )
    }

    if (
      isRoutingChild(definition) &&
      routingChildHasUnresolvedTarget(definition, outgoingRelations.get(definition.id) ?? [])
    ) {
      findings.push(
        indexLintFinding({
          ruleId: 'routing.unresolved_target',
          key: definition.id,
          message: `${definition.kind} "${definition.name}" points at "${routingTargetVariable(definition)}" but no index-visible target was resolved.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Routing target variable has no resolved target relation')],
        }),
      )
    }

    if (definition.kind === 'routing.cascade') {
      const tiers = cascadeTiersByParent.get(definition.id) ?? []
      const unreachableTier = tiers.slice(0, -1).find((tier) => tier.metadata?.hasEvaluate !== true)
      if (unreachableTier) {
        findings.push(
          indexLintFinding({
            ruleId: 'routing.cascade_unreachable_tier',
            key: `${definition.id}:${unreachableTier.id}`,
            message: `Cascade "${definition.name}" has non-terminal tier "${unreachableTier.name}" without an evaluator.`,
            ...((unreachableTier.source ?? definition.source)
              ? { source: unreachableTier.source ?? definition.source }
              : {}),
            primaryDefinitionId: definition.id,
            relatedDefinitionIds: [definition.id, unreachableTier.id],
            evidence: [
              definitionEvidence(definition, 'Cascade contains ordered tiers'),
              definitionEvidence(unreachableTier, 'Non-terminal tier has no evaluate callback'),
            ],
          }),
        )
      }
    }

    const injectionModel = injectionModels.get(definition.id)
    if (injectionModel) {
      for (const entry of injectionModel.unresolvedEntries) {
        const owner = byId.get(entry.ownerDefinitionId)
        findings.push(
          indexLintFinding({
            ruleId: 'injection.unresolved_target',
            key: `${definition.id}:${entry.ownerDefinitionId}:${entry.variable ?? entry.via ?? 'unresolved'}`,
            message: `${definition.kind} "${definition.name}" has an unresolved injection target${entry.variable ? ` "${entry.variable}"` : ''}.`,
            ...((owner?.source ?? definition.source) ? { source: owner?.source ?? definition.source } : {}),
            primaryDefinitionId: definition.id,
            relatedDefinitionIds: [definition.id, entry.ownerDefinitionId],
            evidence: [
              definitionEvidence(definition, 'Definition is affected by an unresolved injection target'),
              ...(entry.ownerDefinitionId !== definition.id && owner
                ? [definitionEvidence(owner, 'Unresolved injection owner')]
                : []),
              {
                kind: 'definition',
                label: 'Unresolved injection entry',
                definitionId: entry.ownerDefinitionId,
                source: owner?.source ?? definition.source,
                data: {
                  variable: entry.variable,
                  conditionality: entry.conditionality,
                  via: entry.via,
                  branch: entry.branch,
                },
              },
            ],
          }),
        )
      }

      for (const entry of injectionModel.dynamicEntries) {
        const owner = byId.get(entry.ownerDefinitionId)
        findings.push(
          indexLintFinding({
            ruleId: 'injection.dynamic_dependency',
            key: `${definition.id}:${entry.ownerDefinitionId}:${entry.variable ?? entry.via ?? 'dynamic'}`,
            message: `${definition.kind} "${definition.name}" has a runtime-dependent injection dependency${entry.variable ? ` "${entry.variable}"` : ''}.`,
            ...(definition.source ? { source: definition.source } : {}),
            primaryDefinitionId: definition.id,
            relatedDefinitionIds: [definition.id, entry.ownerDefinitionId],
            evidence: [
              definitionEvidence(definition, 'Definition is affected by dynamic injection'),
              ...(entry.ownerDefinitionId !== definition.id && owner
                ? [definitionEvidence(owner, 'Dynamic injection owner')]
                : []),
              {
                kind: 'definition',
                label: 'Dynamic injection entry',
                definitionId: entry.ownerDefinitionId,
                source: owner?.source ?? definition.source,
                data: {
                  variable: entry.variable,
                  conditionality: entry.conditionality,
                  via: entry.via,
                  branch: entry.branch,
                },
              },
            ],
          }),
        )
      }

      for (const contribution of dynamicToolContributionsForFinding(injectionModel.toolContributions)) {
        const source = byId.get(contribution.sourceDefinitionId)
        findings.push(
          indexLintFinding({
            ruleId: 'injection.dynamic_tools',
            key: `${definition.id}:${contribution.sourceDefinitionId}:${contribution.name ?? contribution.variable ?? 'dynamic'}`,
            message: `${definition.kind} "${definition.name}" can receive runtime-dependent tools from ${source ? `${source.kind} "${source.name}"` : contribution.sourceDefinitionId}.`,
            ...((source?.source ?? definition.source) ? { source: source?.source ?? definition.source } : {}),
            primaryDefinitionId: definition.id,
            relatedDefinitionIds: [...new Set([definition.id, contribution.sourceDefinitionId])],
            evidence: [
              definitionEvidence(definition, 'Definition can receive injected tools'),
              ...(source ? [definitionEvidence(source, 'Injected tool contributor is dynamic')] : []),
              {
                kind: 'definition',
                label: 'Dynamic tool contribution',
                definitionId: contribution.sourceDefinitionId,
                source: source?.source ?? definition.source,
                data: {
                  name: contribution.name,
                  variable: contribution.variable,
                  path: contribution.path,
                  conditionality: contribution.conditionality,
                  branch: contribution.branch,
                },
              },
            ],
          }),
        )
      }
    }

    if (definition.kind === 'injectable' && !injectionConsumers.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'injectable.unused',
          key: definition.id,
          message: `Injectable "${definition.name}" is not reached by any static injection relation.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Injectable has no static consumers')],
        }),
      )
    }

    if (definition.kind === 'context' && !injectionConsumers.has(definition.id)) {
      findings.push(
        indexLintFinding({
          ruleId: 'context.unused',
          key: definition.id,
          message: `Context "${definition.name}" is not reached by any static injection relation.`,
          ...(definition.source ? { source: definition.source } : {}),
          primaryDefinitionId: definition.id,
          relatedDefinitionIds: [definition.id],
          evidence: [definitionEvidence(definition, 'Context has no static consumers')],
        }),
      )
    }
  }

  findings.push(
    ...stateResourceWriteWithoutReadFindings({
      definitions: input.definitions,
      relations: input.relations,
    }),
  )

  for (const relation of input.relations) {
    if (relation.type === 'agent.can_handoff_to') {
      const agent = byId.get(relation.from)
      const target = byId.get(relation.to)
      if (agent?.kind === 'agent' && target?.kind !== 'agent') {
        findings.push(
          indexLintFinding({
            ruleId: 'agent.unobservable_handoff',
            key: `${relation.from}:${relation.to}`,
            message: `Agent "${agent.name}" hands off to "${relation.to}" but that target is not index-visible.`,
            ...((relation.source ?? agent.source) ? { source: relation.source ?? agent.source } : {}),
            primaryDefinitionId: relation.from,
            relatedDefinitionIds: [relation.from, relation.to],
            evidence: [
              definitionEvidence(agent, 'Agent declares a handoff'),
              relationEvidence(relation, 'Handoff target is not index-visible'),
            ],
          }),
        )
      }
    }

    if (relation.type !== 'swarm.uses_blackboard') continue
    const swarm = byId.get(relation.from)
    const blackboard = byId.get(relation.to)
    if (!swarm || !blackboard || hasConflictPolicy(blackboard)) continue
    findings.push(
      indexLintFinding({
        ruleId: 'shared_blackboard_without_policy',
        key: `${relation.from}:${relation.to}`,
        message: `Swarm "${swarm.name}" shares blackboard "${blackboard.name}" without a visible conflict policy.`,
        ...((relation.source ?? swarm.source ?? blackboard.source)
          ? { source: relation.source ?? swarm.source ?? blackboard.source }
          : {}),
        primaryDefinitionId: relation.from,
        relatedDefinitionIds: [relation.from, relation.to],
        evidence: [
          definitionEvidence(swarm, 'Swarm uses shared blackboard'),
          definitionEvidence(blackboard, 'Blackboard has no visible conflict policy'),
          relationEvidence(relation, 'Shared blackboard relation'),
        ],
      }),
    )
  }

  return propagateFindings(findings, input.relations).sort(compareFindings)
}

function hiddenRequiredInputFindings(
  prompt: ProjectDefinition,
  contributions: readonly InputSchemaContribution[],
  byId: ReadonlyMap<string, ProjectDefinition>,
): IndexLintFinding[] {
  const authoredRequired = new Set(schemaRequiredFields(contractInputSchema(prompt)))
  const expandedRequired = new Set(schemaRequiredFields(contractExpandedInputSchema(prompt)))
  return contributions
    .filter((contribution) => contribution.required === true)
    .filter((contribution) => expandedRequired.has(contribution.field) && !authoredRequired.has(contribution.field))
    .map((contribution) => {
      const source = contribution.sourceDefinitionId ? byId.get(contribution.sourceDefinitionId) : undefined
      return indexLintFinding({
        ruleId: 'prompt.hidden_required_input',
        key: `${prompt.id}:${contribution.field}:${contribution.sourceDefinitionId ?? 'unknown'}`,
        message: `Prompt "${prompt.name}" effectively requires "${contribution.field}" through injected ${source ? `${source.kind} "${source.name}"` : 'input'}.`,
        ...((source?.source ?? prompt.source) ? { source: source?.source ?? prompt.source } : {}),
        primaryDefinitionId: prompt.id,
        relatedDefinitionIds: [prompt.id, ...(source ? [source.id] : [])],
        evidence: [
          definitionEvidence(prompt, 'Prompt input schema does not author this required field'),
          ...(source ? [definitionEvidence(source, 'Injected source contributes the required field')] : []),
          inputContributionEvidence(prompt, contribution, 'Injected required input contribution'),
        ],
      })
    })
}

function indirectToolSurfaceFindings(
  prompt: ProjectDefinition,
  model: InjectionReadModel,
  byId: ReadonlyMap<string, ProjectDefinition>,
): IndexLintFinding[] {
  if (prompt.kind !== 'prompt') return []
  const seen = new Set<string>()
  return model.toolContributions
    .filter((contribution) => contribution.sourceDefinitionId !== prompt.id)
    .filter((contribution) => contribution.dynamic !== true)
    .filter((contribution) => {
      const key = `${contribution.sourceDefinitionId}:${contribution.name ?? contribution.variable ?? 'tools'}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((contribution) => {
      const source = byId.get(contribution.sourceDefinitionId)
      const toolLabel = contribution.name ?? contribution.variable ?? 'tools'
      return indexLintFinding({
        ruleId: 'prompt.indirect_tool_surface',
        key: `${prompt.id}:${contribution.sourceDefinitionId}:${toolLabel}`,
        message: `Prompt "${prompt.name}" receives tool surface "${toolLabel}" through injected ${source ? `${source.kind} "${source.name}"` : contribution.sourceDefinitionId}.`,
        ...((source?.source ?? prompt.source) ? { source: source?.source ?? prompt.source } : {}),
        primaryDefinitionId: prompt.id,
        relatedDefinitionIds: [prompt.id, contribution.sourceDefinitionId],
        evidence: [
          definitionEvidence(prompt, 'Prompt receives tools through injection'),
          ...(source ? [definitionEvidence(source, 'Injected tool contributor')] : []),
          {
            kind: 'definition',
            label: 'Injected tool contribution',
            definitionId: contribution.sourceDefinitionId,
            source: source?.source ?? prompt.source,
            data: {
              name: contribution.name,
              variable: contribution.variable,
              path: contribution.path,
              conditionality: contribution.conditionality,
              branch: contribution.branch,
            },
          },
        ],
      })
    })
}

function deepSchemaChainFindings(
  prompt: ProjectDefinition,
  contributions: readonly InputSchemaContribution[],
  byId: ReadonlyMap<string, ProjectDefinition>,
): IndexLintFinding[] {
  if (prompt.kind !== 'prompt') return []
  const deepContributions = contributions.filter((contribution) => (contribution.path?.length ?? 0) > 2)
  const seen = new Set<string>()
  return deepContributions
    .filter((contribution) => {
      const key = `${contribution.field}:${contribution.sourceDefinitionId ?? 'unknown'}:${contribution.path?.join('>') ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((contribution) => {
      const source = contribution.sourceDefinitionId ? byId.get(contribution.sourceDefinitionId) : undefined
      return indexLintFinding({
        ruleId: 'injection.deep_schema_chain',
        key: `${prompt.id}:${contribution.field}:${contribution.path?.join('>') ?? contribution.sourceDefinitionId ?? 'deep'}`,
        message: `Prompt "${prompt.name}" receives input "${contribution.field}" through a deep injection chain.`,
        ...((source?.source ?? prompt.source) ? { source: source?.source ?? prompt.source } : {}),
        primaryDefinitionId: prompt.id,
        relatedDefinitionIds: [prompt.id, ...(source ? [source.id] : [])],
        evidence: [
          definitionEvidence(prompt, 'Prompt receives input through a deep injection chain'),
          ...(source ? [definitionEvidence(source, 'Deep schema contributor')] : []),
          inputContributionEvidence(prompt, contribution, 'Deep injected input contribution'),
        ],
      })
    })
}

function conditionalRequiredInputFindings(
  prompt: ProjectDefinition,
  contributions: readonly InputSchemaContribution[],
  byId: ReadonlyMap<string, ProjectDefinition>,
): IndexLintFinding[] {
  return contributions
    .filter((contribution) => isConditionalContribution(contribution))
    .filter((contribution) => contributionSourceRequiresField(contribution, byId))
    .map((contribution) => {
      const source = contribution.sourceDefinitionId ? byId.get(contribution.sourceDefinitionId) : undefined
      return indexLintFinding({
        ruleId: 'prompt.conditional_required_input',
        key: `${prompt.id}:${contribution.field}:${contribution.sourceDefinitionId ?? 'unknown'}:${contribution.conditionality ?? 'conditional'}`,
        message: `Prompt "${prompt.name}" has branch-specific required input "${contribution.field}" from ${source ? `${source.kind} "${source.name}"` : 'an injected source'}.`,
        ...((source?.source ?? prompt.source) ? { source: source?.source ?? prompt.source } : {}),
        primaryDefinitionId: prompt.id,
        relatedDefinitionIds: [prompt.id, ...(source ? [source.id] : [])],
        evidence: [
          definitionEvidence(prompt, 'Prompt receives a conditional injected input'),
          ...(source ? [definitionEvidence(source, 'Injected source requires the field')] : []),
          inputContributionEvidence(prompt, contribution, 'Conditional required input contribution'),
          ...conditionSourceEvidence(prompt, contribution, 'Injection condition source'),
        ],
      })
    })
}

function conflictingInjectedInputFindings(
  prompt: ProjectDefinition,
  contributions: readonly InputSchemaContribution[],
  byId: ReadonlyMap<string, ProjectDefinition>,
): IndexLintFinding[] {
  const byField = new Map<string, InputSchemaContribution[]>()
  for (const contribution of contributions) {
    const list = byField.get(contribution.field) ?? []
    list.push(contribution)
    byField.set(contribution.field, list)
  }

  const findings: IndexLintFinding[] = []
  for (const [field, fieldContributions] of byField) {
    for (let index = 0; index < fieldContributions.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < fieldContributions.length; nextIndex += 1) {
        const left = fieldContributions[index]
        const right = fieldContributions[nextIndex]
        if (!left.schema || !right.schema) continue
        const reason = schemaConflictReason(left.schema, right.schema)
        if (!reason) continue
        const leftSource = left.sourceDefinitionId ? byId.get(left.sourceDefinitionId) : undefined
        const rightSource = right.sourceDefinitionId ? byId.get(right.sourceDefinitionId) : undefined
        findings.push(
          indexLintFinding({
            ruleId: 'prompt.conflicting_injected_input',
            key: `${prompt.id}:${field}:${left.sourceDefinitionId ?? index}:${right.sourceDefinitionId ?? nextIndex}`,
            message: `Prompt "${prompt.name}" receives incompatible injected schemas for input "${field}" (${reason}).`,
            ...((leftSource?.source ?? rightSource?.source ?? prompt.source)
              ? { source: leftSource?.source ?? rightSource?.source ?? prompt.source }
              : {}),
            primaryDefinitionId: prompt.id,
            relatedDefinitionIds: [
              prompt.id,
              ...(leftSource ? [leftSource.id] : []),
              ...(rightSource ? [rightSource.id] : []),
            ],
            evidence: [
              definitionEvidence(prompt, 'Prompt receives conflicting injected input'),
              ...(leftSource ? [definitionEvidence(leftSource, 'First injected schema contributor')] : []),
              ...(rightSource ? [definitionEvidence(rightSource, 'Second injected schema contributor')] : []),
              inputContributionEvidence(prompt, left, 'First injected input contribution'),
              inputContributionEvidence(prompt, right, 'Second injected input contribution'),
            ],
          }),
        )
      }
    }
  }
  return findings
}

function inputContributionEvidence(
  owner: ProjectDefinition,
  contribution: InputSchemaContribution,
  label: string,
): IndexLintFinding['evidence'][number] {
  return {
    kind: 'definition',
    label,
    definitionId: contribution.sourceDefinitionId ?? owner.id,
    source: owner.source,
    data: {
      field: contribution.field,
      sourceDefinitionId: contribution.sourceDefinitionId,
      sourceName: contribution.sourceName,
      sourceKind: contribution.sourceKind,
      required: contribution.required,
      conditionality: contribution.conditionality,
      branch: contribution.branch,
      via: contribution.via,
      path: contribution.path,
      schema: contribution.schema,
    },
  }
}

/**
 * Returns source-level evidence for the condition that made an input field
 * reachable through injection.
 *
 * The injection read model tells the rule that a field is conditional, but it
 * intentionally does not own source navigation. This helper joins that
 * contribution back to condition-tagged `sourceRefs`, allowing clients to jump
 * from a branch-specific lint to the authored `when`, `match`, or guarded
 * expression without reparsing source or duplicating semantic matching logic.
 */
function conditionSourceEvidence(
  owner: ProjectDefinition,
  contribution: InputSchemaContribution,
  label: string,
): IndexLintFinding['evidence'] {
  return conditionSourceRefs(owner, contribution).map((ref) => ({
    kind: 'source',
    label,
    source: ref.source,
    data: {
      definitionId: owner.id,
      role: ref.role,
      property: ref.property,
      symbol: ref.symbol,
      fidelity: ref.fidelity,
      injectionCondition: ref.metadata?.extensions?.injectionCondition,
      via: ref.metadata?.extensions?.via,
      branch: ref.metadata?.extensions?.branch,
    },
  }))
}

/**
 * Selects the condition refs that are safe evidence for one schema
 * contribution.
 *
 * Matching is intentionally conservative: branch-specific contributions only
 * use refs with the same branch label, while branchless contributions accept
 * any ref for the expected condition class. This avoids attaching a `match`
 * branch's source location to a field contributed by a different branch.
 */
function conditionSourceRefs(
  owner: ProjectDefinition,
  contribution: InputSchemaContribution,
): ProjectSourceRef[] {
  const expected = injectionConditionSourceKinds(contribution)
  if (expected.size === 0) return []
  return (owner.sourceRefs ?? []).filter((ref) => {
    if (ref.property !== 'use') return false
    const extensions = ref.metadata?.extensions
    const condition = extensions?.injectionCondition
    if (typeof condition !== 'string' || !expected.has(condition)) return false
    const branch = extensions?.branch
    return contribution.branch ? branch === contribution.branch : true
  })
}

/**
 * Translates read-model conditionality into the source-ref condition tags that
 * are valid evidence for that contribution.
 *
 * The mapping is narrower than the runtime vocabulary on purpose. For example,
 * `match-case` evidence should come from the specific case target, not the
 * classifier or config object, because the lint is explaining why this field
 * appears on that branch.
 */
function injectionConditionSourceKinds(contribution: InputSchemaContribution): Set<string> {
  switch (contribution.conditionality) {
    case 'when':
      return new Set(['when-predicate', 'when-target'])
    case 'match-case':
      return new Set(['match-case'])
    case 'match-default':
      return new Set(['match-default'])
    case 'binary-guard':
      return new Set(['binary-guard'])
    default:
      return new Set()
  }
}

function isConditionalContribution(contribution: InputSchemaContribution): boolean {
  return Boolean(
    contribution.conditionality &&
    contribution.conditionality !== 'always' &&
    contribution.conditionality !== 'unknown',
  )
}

function schemaConflictReason(left: JsonSchema, right: JsonSchema): string | undefined {
  const leftType = schemaType(left)
  const rightType = schemaType(right)
  if (leftType && rightType && leftType !== rightType) return `${leftType} vs ${rightType}`
  const leftConst = left.const
  const rightConst = right.const
  if (leftConst !== undefined && rightConst !== undefined && leftConst !== rightConst) return 'different const values'
  const leftEnum = stringEnumValues(left)
  const rightEnum = stringEnumValues(right)
  if (leftEnum && rightEnum && !sameStringSet(leftEnum, rightEnum)) return 'different enum values'
  return undefined
}

function schemaType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.type))
    return schema.type
      .filter((item): item is string => typeof item === 'string')
      .sort()
      .join('|')
  if (Object.keys(schemaProperties(schema)).length > 0) return 'object'
  if (schema.items) return 'array'
  return undefined
}

function stringEnumValues(schema: JsonSchema): readonly string[] | undefined {
  if (!Array.isArray(schema.enum)) return undefined
  const values = schema.enum.filter((value): value is string => typeof value === 'string')
  return values.length === schema.enum.length ? values.sort() : undefined
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function dynamicToolContributionsForFinding(
  contributions: readonly InjectionToolContribution[],
): InjectionToolContribution[] {
  const seen = new Set<string>()
  return contributions.filter((contribution) => {
    if (contribution.dynamic !== true) return false
    const key = contribution.sourceDefinitionId
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function injectionConsumedDefinitionIds(relations: readonly ProjectRelation[]): Set<string> {
  const consumed = new Set<string>()
  for (const relation of relations) {
    if (isContextOrInjectableUseRelation(relation.type)) consumed.add(relation.to)
  }
  return consumed
}

function isContextOrInjectableUseRelation(relationType: string): boolean {
  return (
    relationType === 'prompt.uses_context' ||
    relationType === 'prompt.uses_injectable' ||
    relationType === 'context.uses_context' ||
    relationType === 'context.uses_injectable' ||
    relationType === 'injectable.uses_context'
  )
}

/**
 * Finds state resources that receive writes but are never read by indexed
 * definitions.
 */
export function stateResourceWriteWithoutReadFindings(input: {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}): IndexLintFinding[] {
  const byId = new Map(input.definitions.map((definition) => [definition.id, definition]))
  const writesByTarget = new Map<string, ProjectRelation[]>()
  const readTargets = new Set<string>()

  for (const relation of input.relations) {
    if (isStateResourceReadRelation(relation)) {
      readTargets.add(relation.to)
      continue
    }
    if (!isStateResourceWriteRelation(relation)) continue
    const writes = writesByTarget.get(relation.to) ?? []
    writes.push(relation)
    writesByTarget.set(relation.to, writes)
  }

  const findings: IndexLintFinding[] = []
  for (const [targetId, writes] of writesByTarget) {
    if (readTargets.has(targetId)) continue
    const target = byId.get(targetId)
    const source = target?.source ?? writes.find((relation) => relation.source)?.source
    const finding = indexLintFinding({
      ruleId: 'resource.write_without_read',
      key: targetId,
      message: `${stateResourceLabel(targetId, target)} receives writes but has no index-visible read path.`,
      ...(source ? { source } : {}),
      primaryDefinitionId: targetId,
      relatedDefinitionIds: [targetId],
      evidence: [
        ...(target ? [definitionEvidence(target, 'State resource receives writes')] : []),
        ...writes.map((relation) => relationEvidence(relation, 'Visible write without a matching read')),
      ],
    })
    findings.push({
      ...finding,
      affectedDefinitionIds: [
        ...new Set([...(finding.affectedDefinitionIds ?? []), ...writes.map((relation) => relation.from)]),
      ].sort(),
    })
  }

  return findings
}
