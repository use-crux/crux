import ts from 'typescript'
import { hasProperty, stringProperty } from '../ast/literals'
import { expressionToJsonSchema, schemaProperty } from '../ast/schemas'
import { foldedIndexChild } from '../index-presentation'
import type { ExtractedFacts } from '../extensions'
import { internalFlowTraversal, type InternalFlowSuspensionRef } from '../extensions/internal-flow-traversal'
import type { StaticRelationRef } from '../types'
import type { StaticCallContext } from './types'
import { primitiveDataIntelligence } from './data-access'

/**
 * Projects a parser-owned `flow(...)` call into immutable index facts.
 *
 * The function owns index identity, folded step definitions, and relation refs. Source traversal for
 * steps/suspensions is delegated to `internalFlowTraversal` so this layer can stay focused on fact
 * projection while preserving the existing static compiler contract.
 */
export function flowFactsFromStaticContext(ctx: StaticCallContext): ExtractedFacts | undefined {
  if (ctx.callName !== 'flow' && ctx.callName !== 'cruxFlow') return undefined
  const explicitName = flowName(ctx)
  const flowDefinitionKey = explicitName ?? ctx.localName
  const id = `flow:${ctx.safeId(explicitName ?? ctx.localName)}`
  const traversal = internalFlowTraversal(ctx, flowDefinitionKey)
  const stepRefs = traversal.steps
  const stepNames = [...new Set(stepRefs.map((step) => step.name))]
  const suspensionRefs = traversal.suspensions
  const argsSchema = flowArgsSchema(ctx)
  const stepDefinitions = stepNames.map((stepName, index) => {
    const sourceRefs = stepRefs.filter((step) => step.name === stepName).flatMap((step) => step.sourceRefs)
    const definition = ctx.define(
      `flow.step:${ctx.safeId(explicitName ?? ctx.localName)}:${ctx.safeId(stepName)}`,
      'flow.step',
      stepName,
      undefined,
      {
        exportName: ctx.variableName,
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
  const stepUsageRefs = stepRefs.flatMap((step): StaticRelationRef[] => {
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
  const suspensionRelationRefs = suspensionRefs.flatMap((suspension): StaticRelationRef[] => {
    const stepId = suspension.stepName ? stepIdByName.get(suspension.stepName) : undefined
    if (!stepId) return []
    return [
      {
        type: 'flow.step.waits_for_signal',
        toId: `signal:${ctx.safeId(suspension.signal)}`,
        fromId: stepId,
      },
    ]
  })
  const dataRelationRefs = stepRefs.flatMap((step): StaticRelationRef[] => {
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
  return {
    definitions: [
      {
        variableName: ctx.variableName,
        definition: ctx.define(id, 'flow', explicitName ?? ctx.variableName, undefined, {
          exportName: ctx.variableName,
          stepNames,
          args: ctx.objectArg ? objectPropertyKeys(ctx.objectArg, 'args') : undefined,
          argsSchema,
          hasArgs: ctx.objectArg ? hasProperty(ctx.objectArg, 'args') : false,
          facts: {
            kind: 'flow',
            stepNames,
            hasArgs: ctx.objectArg ? hasProperty(ctx.objectArg, 'args') : false,
            runtime: ctx.callName === 'cruxFlow' ? 'convex' : 'node',
          },
          intelligence: primitiveFlowIntelligence(
            ctx.callName,
            argsSchema,
            suspensionRefs,
            stepDefinitions.map((stepDefinition) => stepDefinition.id),
          ),
          runtime: ctx.callName === 'cruxFlow' ? 'convex' : undefined,
        }),
        extraDefinitions: stepDefinitions,
      },
    ],
    references: [
      ...stepDefinitions.map((stepDefinition) => ({ type: 'flow.includes_step', toId: stepDefinition.id })),
      ...stepUsageRefs,
      ...suspensionRelationRefs,
      ...dataRelationRefs,
    ],
  }
}

/** Reads the authored flow name from either positional or object-style flow declarations. */
function flowName(ctx: StaticCallContext): string | undefined {
  if (ctx.firstArg && ts.isStringLiteralLike(ctx.firstArg)) return ctx.firstArg.text
  return ctx.objectArg ? stringProperty(ctx.objectArg, 'name') : undefined
}

/** Projects the flow argument contract from normal schema properties or Convex args objects. */
function flowArgsSchema(ctx: StaticCallContext): Record<string, unknown> | undefined {
  if (!ctx.objectArg) return undefined
  return (
    schemaProperty(ctx.objectArg, 'args', ctx.localInitializers) ??
    convexArgsSchema(ctx.objectArg, ctx.localInitializers)
  )
}

/**
 * Converts Convex-style `args` objects into JSON Schema using the shared schema projection helper.
 *
 * This preserves the previous static contract behavior for `cruxFlow({ args: ... })` without making
 * flow extraction responsible for general schema parsing.
 */
function convexArgsSchema(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): Record<string, unknown> | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'args',
  )
  if (!property) return undefined
  return expressionToJsonSchema(property.initializer, localInitializers)
}

/**
 * Builds static flow intelligence metadata from resolved contract, child, and suspension evidence.
 *
 * The metadata is intentionally index-facing: it describes execution mode, child ordering, and
 * suspension points without exposing parser traversal details.
 */
function primitiveFlowIntelligence(
  callName: string,
  argsSchema: Record<string, unknown> | undefined,
  suspensions: readonly InternalFlowSuspensionRef[],
  childDefinitionIds: readonly string[],
): Record<string, unknown> {
  const control: Record<string, unknown> = {
    mode: callName === 'cruxFlow' ? 'durable' : 'immediate',
    ordering: 'ordered',
    ...(childDefinitionIds.length > 0 ? { children: [...childDefinitionIds] } : {}),
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

/** Converts supported TypeScript property names into stable string keys for internal schema helpers. */
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

/**
 * Returns object-literal keys from a named property for lightweight flow metadata.
 *
 * Unsupported property shapes return `undefined`; callers should treat that as unknown rather than an
 * empty authored contract.
 */
function objectPropertyKeys(object: ts.ObjectLiteralExpression, name: string): string[] | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name,
  )
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) return undefined
  const keys = property.initializer.properties
    .map((item) => {
      if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return undefined
      return propertyName(item.name)
    })
    .filter((value): value is string => typeof value === 'string')
  return keys.length > 0 ? keys : undefined
}
