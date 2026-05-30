import ts from 'typescript'
import { hasProperty, stringProperty } from '../ast/literals'
import { expressionToJsonSchema, schemaProperty } from '../ast/schemas'
import { helperSourceRefsForNode, projectSourceRef, resolveIdentifierSourceNode } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'
import { primitiveDataAccessRefs, primitiveDataAccessRefsWithHelpers, primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'

export const flowExtractor: PrimitiveExtractor = {
  name: 'flow',
  capabilities: ['definition', 'relation', 'source', 'runtime-join', 'partial'],
  callNames: ['flow', 'cruxFlow'],
  extract: (ctx) => {
    if (ctx.callName !== 'flow' && ctx.callName !== 'cruxFlow') return undefined
    const explicitName = flowName(ctx)
    const id = `flow:${ctx.safeId(explicitName ?? ctx.localName)}`
    const stepRefs = flowStepRefs(ctx)
    const stepNames = [...new Set(stepRefs.map((step) => step.name))]
    const suspensionRefs = flowSuspensionRefs(ctx.call, stepNames[stepNames.length - 1])
    const argsSchema = flowArgsSchema(ctx)
    const stepDefinitions = stepNames.map((stepName) => {
      const sourceRefs = stepRefs.filter((step) => step.name === stepName).flatMap((step) => step.sourceRefs)
      const definition = ctx.define(`flow.step:${ctx.safeId(explicitName ?? ctx.localName)}:${ctx.safeId(stepName)}`, 'flow.step', stepName, undefined, {
        exportName: ctx.variableName,
        flowId: id,
        static: true,
        intelligence: primitiveDataIntelligence(stepRefs.filter((step) => step.name === stepName).flatMap((step) => step.dataAccesses)),
      })
      return sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition
    })
    const stepIdByName = new Map(stepDefinitions.map((definition) => [definition.name, definition.id]))
    const stepUsageRefs = stepRefs.flatMap((step) => {
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
          },
          toVariable: step.targetVariable,
          fromId: stepId,
        },
      ]
    })
    const suspensionRelationRefs = suspensionRefs.flatMap((suspension) => {
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
    const dataRelationRefs = stepRefs.flatMap((step) => {
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
    return foundDefinition(
      ctx.variableName,
      ctx.define(id, 'flow', explicitName ?? ctx.variableName, undefined, {
        exportName: ctx.variableName,
        stepNames,
        args: ctx.objectArg ? objectPropertyKeys(ctx.objectArg, 'args') : undefined,
        argsSchema,
        hasArgs: ctx.objectArg ? hasProperty(ctx.objectArg, 'args') : false,
        intelligence: primitiveFlowIntelligence(ctx.callName, argsSchema, suspensionRefs),
        runtime: ctx.callName === 'cruxFlow' ? 'convex' : undefined,
      }),
      [
        ...stepDefinitions.map((stepDefinition) => ({ type: 'flow.includes_step', toId: stepDefinition.id })),
        ...stepUsageRefs,
        ...suspensionRelationRefs,
        ...dataRelationRefs,
      ],
      stepDefinitions,
    )
  },
}

function flowName(ctx: Parameters<PrimitiveExtractor['extract']>[0]): string | undefined {
  if (ctx.firstArg && ts.isStringLiteralLike(ctx.firstArg)) return ctx.firstArg.text
  return ctx.objectArg ? stringProperty(ctx.objectArg, 'name') : undefined
}

function flowArgsSchema(ctx: Parameters<PrimitiveExtractor['extract']>[0]): Record<string, unknown> | undefined {
  if (!ctx.objectArg) return undefined
  return schemaProperty(ctx.objectArg, 'args', ctx.localInitializers) ?? convexArgsSchema(ctx.objectArg, ctx.localInitializers)
}

function convexArgsSchema(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): Record<string, unknown> | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'args')
  if (!property) return undefined
  return expressionToJsonSchema(property.initializer, localInitializers)
}

function primitiveFlowIntelligence(
  callName: string,
  argsSchema: Record<string, unknown> | undefined,
  suspensions: readonly FlowSuspensionRef[],
): Record<string, unknown> {
  const control: Record<string, unknown> = {
    mode: callName === 'cruxFlow' ? 'durable' : 'immediate',
    ordering: 'ordered',
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

interface FlowStepRef {
  readonly name: string
  readonly targetVariable?: string
  readonly dataAccesses: PrimitiveDataAccessRef[]
  readonly sourceRefs: NonNullable<ReturnType<typeof helperSourceRefsForNode>>
}

interface FlowSuspensionRef {
  readonly signal: string
  readonly stepName?: string
}

function flowStepRefs(ctx: Parameters<PrimitiveExtractor['extract']>[0]): FlowStepRef[] {
  const refs: FlowStepRef[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'step') {
      const firstArg = node.arguments[0]
      if (firstArg && ts.isStringLiteralLike(firstArg)) {
        const targetArg = node.arguments[1]
        const stepDefinitionId = `flow.step:${ctx.safeId(flowName(ctx) ?? ctx.localName)}:${ctx.safeId(firstArg.text)}`
        const resolved = targetArg && ts.isIdentifier(targetArg)
          ? resolveIdentifierSourceNode(ctx.root, ctx.file, ctx.sourceFile, targetArg.text, ctx.localInitializers)
          : undefined
        const callbackSourceRefs = resolved
          ? [
              projectSourceRef({
                definitionId: stepDefinitionId,
                role: 'handler',
                property: 'step',
                resolved,
              }),
              ...helperSourceRefsForNode({
                definitionId: stepDefinitionId,
                root: ctx.root,
                file: resolved.sourceFile.fileName,
                sourceFile: resolved.sourceFile,
                node: resolved.node,
                localInitializers: resolved.localInitializers,
              }),
            ]
          : []
        const dataAccesses = resolved
          ? primitiveDataAccessRefsWithHelpers(resolved.node, resolved.sourceFile, {
              root: ctx.root,
              file: resolved.sourceFile.fileName,
              localInitializers: resolved.localInitializers,
            })
          : targetArg
            ? primitiveDataAccessRefs(targetArg, ctx.sourceFile)
            : []
        refs.push({
          name: firstArg.text,
          targetVariable: targetArg && ts.isIdentifier(targetArg) ? targetArg.text : undefined,
          dataAccesses,
          sourceRefs: callbackSourceRefs,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  const initializer = ctx.call
  const objectArg = initializer.arguments[0]
  if (objectArg && ts.isObjectLiteralExpression(objectArg)) {
    const handler = objectArg.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'handler')
    if (handler) visit(handler.initializer)
  } else {
    for (const arg of initializer.arguments.slice(1)) visit(arg)
  }
  return refs
}

function flowSuspensionRefs(initializer: ts.CallExpression, fallbackStepName: string | undefined): FlowSuspensionRef[] {
  const refs: FlowSuspensionRef[] = []
  let currentStepName: string | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const firstArg = node.arguments[0]
      if (method === 'step' && firstArg && ts.isStringLiteralLike(firstArg)) {
        currentStepName = firstArg.text
      }
      if ((method === 'waitFor' || method === 'suspend') && firstArg && ts.isStringLiteralLike(firstArg)) {
        refs.push({ signal: firstArg.text, stepName: currentStepName ?? fallbackStepName })
      }
    }
    ts.forEachChild(node, visit)
  }
  const objectArg = initializer.arguments[0]
  if (objectArg && ts.isObjectLiteralExpression(objectArg)) {
    const handler = objectArg.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'handler')
    if (handler) visit(handler.initializer)
  } else {
    for (const arg of initializer.arguments.slice(1)) visit(arg)
  }
  return refs
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function objectPropertyKeys(object: ts.ObjectLiteralExpression, name: string): string[] | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) return undefined
  const keys = property.initializer.properties
    .map((item) => {
      if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return undefined
      return propertyName(item.name)
    })
    .filter((value): value is string => typeof value === 'string')
  return keys.length > 0 ? keys : undefined
}
