import type {
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectSourceRef,
  SourceLocation,
} from '@use-crux/core/project-index'
import { foldedIndexChild } from '../index-presentation'
import type { ExtractedFacts } from '../extensions'
import type { StaticRelationRef } from '../types'
import { primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'

/** Source-local flow step evidence after parser-specific traversal has been normalized. */
export interface FlowStepEvidence {
  /** Authored step label. */
  readonly name: string
  /** Authored target binding passed to the step, when statically visible. */
  readonly targetVariable?: string
  /** Data access visible in an inline or resolved step handler. */
  readonly dataAccesses: readonly PrimitiveDataAccessRef[]
  /** Supplemental source refs for the step handler. */
  readonly sourceRefs: readonly ProjectSourceRef[]
}

/** Source-local suspension evidence after parser-specific traversal has been normalized. */
export interface FlowSuspensionEvidence {
  /** Signal id passed to `waitFor(...)` or `suspend(...)`. */
  readonly signal: string
  /** Nearest preceding step label, when source order can establish one. */
  readonly stepName?: string
}

export interface FlowRuntimeUsageEvidence {
  readonly method: 'waitFor' | 'defer' | 'after' | 'untilIdle'
  readonly source?: SourceLocation
  readonly closureTarget?: boolean
  readonly nonSerializablePayload?: string
}

export interface FlowNondeterministicEvidence {
  readonly expression: 'Date.now' | 'Math.random' | 'new Date'
  readonly source?: SourceLocation
}

/** Immutable traversal evidence needed to project a static flow definition. */
export interface FlowTraversalEvidence {
  /** Ordered step calls discovered inside the flow handler. */
  readonly steps: readonly FlowStepEvidence[]
  /** Ordered suspension calls discovered inside the flow handler. */
  readonly suspensions: readonly FlowSuspensionEvidence[]
  readonly runtimeUsages: readonly FlowRuntimeUsageEvidence[]
  readonly nondeterministicCalls: readonly FlowNondeterministicEvidence[]
}

/** Function used by parser adapters to build a Project Index definition with their source defaults. */
export type FlowDefinitionFactory = (
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  metadata: Record<string, unknown>,
) => ProjectDefinition

/** Backend-neutral input for projecting normalized flow evidence into immutable index facts. */
export interface FlowFactProjectionInput {
  /** Source binding associated with the flow definition. */
  readonly variableName: string
  /** Source-local fallback name used when no explicit flow name exists. */
  readonly localName: string
  /** Matched factory name, currently `flow` or `cruxFlow`. */
  readonly callName: string
  /** Authored runtime family inferred by parser-specific adapters. */
  readonly runtime?: 'convex' | 'node'
  /** Authored flow name from positional or object-style config. */
  readonly explicitName?: string
  /** Whether the runtime target name came from a literal string. */
  readonly nameLiteral: boolean
  /** Whether the source declaration can be imported by generated runtime artifacts. */
  readonly exported: boolean
  /** Authored argument keys when a static args object exists. */
  readonly args?: readonly string[]
  /** JSON schema projected from the flow args contract. */
  readonly argsSchema?: Record<string, unknown>
  /** Whether an args contract property is present. */
  readonly hasArgs: boolean
  /** Local signal names declared on the flow definition, when statically visible. */
  readonly signalNames?: readonly string[]
  /** Normalized traversal evidence from the selected syntax frontend. */
  readonly traversal: FlowTraversalEvidence
  /** Compiler-owned id sanitizer. */
  readonly safeId: (value: string) => string
  /** Definition factory bound to parser-specific source defaults. */
  readonly define: FlowDefinitionFactory
}

/** Projects parser-neutral flow evidence into the existing static Project Index fact contract. */
export function flowFactsFromEvidence(input: FlowFactProjectionInput): ExtractedFacts {
  const flowDefinitionKey = input.explicitName ?? input.localName
  const id = `flow:${input.safeId(flowDefinitionKey)}`
  const runtime = input.runtime ?? (input.callName === 'cruxFlow' ? 'convex' : 'node')
  const stepRefs = input.traversal.steps
  const stepNames = [...new Set(stepRefs.map((step) => step.name))]
  const suspensionRefs = input.traversal.suspensions
  const stepDefinitions = stepNames.map((stepName, index) => {
    const sourceRefs = stepRefs.filter((step) => step.name === stepName).flatMap((step) => step.sourceRefs)
    const definition = input.define(
      `flow.step:${input.safeId(flowDefinitionKey)}:${input.safeId(stepName)}`,
      'flow.step',
      stepName,
      {
        exportName: input.variableName,
        flowId: id,
        static: true,
        indexPresentation: foldedIndexChild({
          parentDefinitionId: id,
          parentRelationType: 'flow.includes_step',
          role: 'step',
          order: index,
        }),
        facts: {
          kind: 'flow.step',
          flowId: id,
          stepLabel: stepName,
        },
        intelligence: primitiveDataIntelligence(
          stepRefs.filter((step) => step.name === stepName).flatMap((step) => step.dataAccesses),
        ),
      },
    )
    return sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition
  })
  const stepIdByName = new Map(stepDefinitions.map((definition) => [definition.name, definition.id]))
  return {
    definitions: [
      {
        variableName: input.variableName,
        definition: input.define(id, 'flow', input.explicitName ?? input.variableName, {
          exportName: input.variableName,
          runtimeTarget: {
            kind: 'flow',
            nameLiteral: input.nameLiteral,
            exported: input.exported,
          },
          stepNames,
          args: input.args,
          argsSchema: input.argsSchema,
          hasArgs: input.hasArgs,
          signalNames: input.signalNames,
          runtimeUsages: input.traversal.runtimeUsages,
          nondeterministicCalls: input.traversal.nondeterministicCalls,
          facts: {
            kind: 'flow',
            stepNames,
            hasArgs: input.hasArgs,
            signalNames: input.signalNames,
            runtime,
          },
          intelligence: primitiveFlowIntelligence(
            runtime,
            input.argsSchema,
            stepRefs.map((step) => step.name),
            suspensionRefs,
            stepDefinitions.map((stepDefinition) => stepDefinition.id),
          ),
          runtime: runtime === 'convex' ? 'convex' : undefined,
        }),
        extraDefinitions: stepDefinitions,
      },
    ],
    references: [
      ...stepDefinitions.map((stepDefinition) => ({ type: 'flow.includes_step', toId: stepDefinition.id })),
      ...stepUsageRefs(stepRefs, stepIdByName),
      ...suspensionRelationRefs(suspensionRefs, stepIdByName, input.safeId),
      ...dataRelationRefs(stepRefs, stepIdByName),
    ],
  }
}

function stepUsageRefs(
  stepRefs: readonly FlowStepEvidence[],
  stepIdByName: ReadonlyMap<string, string>,
): readonly StaticRelationRef[] {
  return stepRefs.flatMap((step): StaticRelationRef[] => {
    const stepId = stepIdByName.get(step.name)
    if (!stepId || !step.targetVariable) return []
    return [
      {
        type: 'flow.step.uses_agent',
        typeByTargetKind: {
          agent: 'flow.step.uses_agent',
          prompt: 'flow.step.uses_prompt',
          tool: 'flow.step.uses_tool',
          memory: 'flow.step.uses_memory',
          blackboard: 'flow.step.uses_blackboard',
          'routing.router': 'flow.step.uses_routing',
          'routing.cascade': 'flow.step.uses_routing',
          'routing.fallback': 'flow.step.uses_routing',
        },
        toVariable: step.targetVariable,
        fromId: stepId,
      },
    ]
  })
}

function suspensionRelationRefs(
  suspensionRefs: readonly FlowSuspensionEvidence[],
  stepIdByName: ReadonlyMap<string, string>,
  safeId: (value: string) => string,
): readonly StaticRelationRef[] {
  return suspensionRefs.flatMap((suspension): StaticRelationRef[] => {
    const stepId = suspension.stepName ? stepIdByName.get(suspension.stepName) : undefined
    if (!stepId) return []
    return [
      {
        type: 'flow.step.waits_for_signal',
        toId: `signal:${safeId(suspension.signal)}`,
        fromId: stepId,
      },
    ]
  })
}

function dataRelationRefs(
  stepRefs: readonly FlowStepEvidence[],
  stepIdByName: ReadonlyMap<string, string>,
): readonly StaticRelationRef[] {
  return stepRefs.flatMap((step): StaticRelationRef[] => {
    const stepId = stepIdByName.get(step.name)
    if (!stepId) return []
    return step.dataAccesses.map((access) => ({
      type: access.kind === 'read' ? 'flow.step.reads_memory' : 'flow.step.writes_memory',
      typeByTargetKind:
        access.kind === 'read'
          ? {
              memory: 'flow.step.reads_memory',
              blackboard: 'flow.step.reads_blackboard',
              workspace: 'flow.step.reads_workspace',
            }
          : {
              memory: 'flow.step.writes_memory',
              blackboard: 'flow.step.writes_blackboard',
              workspace: 'flow.step.writes_workspace',
            },
      toVariable: access.targetVariable,
      fromId: stepId,
    }))
  })
}

function primitiveFlowIntelligence(
  runtime: 'convex' | 'node',
  argsSchema: Record<string, unknown> | undefined,
  stepLabels: readonly string[],
  suspensions: readonly FlowSuspensionEvidence[],
  childDefinitionIds: readonly string[],
): Record<string, unknown> {
  const control: Record<string, unknown> = {
    mode: runtime === 'convex' ? 'durable' : 'immediate',
    ordering: 'ordered',
    ...(childDefinitionIds.length > 0 ? { children: [...childDefinitionIds] } : {}),
    ...(stepLabels.length > 0
      ? {
          steps: stepLabels.map((label) => ({
            id: label,
            label,
          })),
        }
      : {}),
  }
  if (suspensions.length > 0) {
    control.suspensionPoints = suspensions.map((suspension) => ({
      id: suspension.signal,
      label: suspension.signal,
      signal: suspension.signal,
    }))
  }
  return {
    confidence: 'static',
    ...(argsSchema ? { contract: { argsSchema } } : {}),
    control,
  }
}
