import ts from 'typescript'
import { hasProperty, propertyName, stringProperty } from '../ast/literals'
import { callbackSourceRefForProperty, helperSourceRefsForNode, resolvedSourceNodeForProperty, schemaPropertyWithSourceRef, sourceRefForProperty, sourceRefsForTemplateInterpolations } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'
import { primitiveDataAccessRefsWithHelpers, primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'

export const promptExtractor: PrimitiveExtractor = {
  name: 'prompt',
  capabilities: ['definition', 'relation', 'schema', 'source', 'runtime-join', 'partial'],
  callNames: ['prompt'],
  extract: (ctx) => {
    if (ctx.callName !== 'prompt' || !ctx.objectArg) return undefined
    const explicitId = stringProperty(ctx.objectArg, 'id')
    const id = `prompt:${ctx.safeId(explicitId ?? ctx.localName)}`
    const inputSchema = schemaPropertyWithSourceRef({
      root: ctx.root,
      file: ctx.file,
      sourceFile: ctx.sourceFile,
      object: ctx.objectArg,
      property: 'input',
      definitionId: id,
      localInitializers: ctx.localInitializers,
    })
    const outputSchema = schemaPropertyWithSourceRef({
      root: ctx.root,
      file: ctx.file,
      sourceFile: ctx.sourceFile,
      object: ctx.objectArg,
      property: 'output',
      definitionId: id,
      localInitializers: ctx.localInitializers,
    })
    const callbackProperties = ['prompt', 'system']
    const resolvedCallbacks = callbackProperties
      .map((property) => ({ property, resolved: resolvedSourceNodeForProperty({ ...ctx, object: ctx.objectArg!, property }) }))
      .filter((item): item is { property: string; resolved: NonNullable<typeof item.resolved> } => Boolean(item.resolved))
    const callbackRefs = [
      callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'prompt', role: 'prompt', definitionId: id }),
      sourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'system', role: 'system', definitionId: id, metadata: { fragment: true } }) ??
        callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'system', role: 'system', definitionId: id }),
    ].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
    const interpolationRefs = sourceRefsForTemplateInterpolations({
      ...ctx,
      object: ctx.objectArg,
      property: 'system',
      role: 'system',
      definitionId: id,
    })
    const helperRefs = resolvedCallbacks.flatMap((item) =>
      helperSourceRefsForNode({
        definitionId: id,
        root: ctx.root,
        file: item.resolved.sourceFile.fileName,
        sourceFile: item.resolved.sourceFile,
        node: item.resolved.node,
        localInitializers: item.resolved.localInitializers,
      }),
    )
    const dataAccesses = resolvedCallbacks.flatMap((item) =>
      primitiveDataAccessRefsWithHelpers(item.resolved.node, item.resolved.sourceFile, {
        root: ctx.root,
        file: item.resolved.sourceFile.fileName,
        localInitializers: item.resolved.localInitializers,
      }),
    )
    const sourceRefs = [...inputSchema.sourceRefs, ...outputSchema.sourceRefs, ...callbackRefs, ...interpolationRefs, ...helperRefs]
    const dataIntelligence = primitiveDataIntelligence(dataAccesses)
    return foundDefinition(
      ctx.variableName,
      {
        ...ctx.define(id, 'prompt', explicitId ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          inputSchema: inputSchema.schema,
          outputSchema: outputSchema.schema,
          hasOutput: hasProperty(ctx.objectArg, 'output'),
          facts: {
            kind: 'prompt',
            use: contextUseVariables(ctx.objectArg, ctx.localInitializers),
            hasSystem: hasProperty(ctx.objectArg, 'system'),
            hasPrompt: hasProperty(ctx.objectArg, 'prompt'),
            hasMessages: hasProperty(ctx.objectArg, 'messages'),
          },
          intelligence: {
            confidence: 'static',
            ...(inputSchema.schema || outputSchema.schema
              ? { contract: { ...(inputSchema.schema ? { inputSchema: inputSchema.schema } : {}), ...(outputSchema.schema ? { outputSchema: outputSchema.schema } : {}) } }
              : {}),
            ...(dataIntelligence?.data ? { data: dataIntelligence.data } : {}),
          },
        }),
        ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      },
      [
        ...contextUseVariables(ctx.objectArg, ctx.localInitializers).map((toVariable) => ({ type: 'prompt.uses_context', toVariable })),
        ...dataAccessRelationRefs(id, dataAccesses),
      ],
    )
  },
}

function contextUseVariables(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): string[] {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'use',
  )
  if (!property) return []
  return contextUseVariablesFromExpression(property.initializer, localInitializers)
}

function contextUseVariablesFromExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  seen = new Set<string>(),
): string[] {
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => {
      if (ts.isIdentifier(element)) return [element.text]
      if (ts.isSpreadElement(element)) return contextUseVariablesFromExpression(element.expression, localInitializers, seen)
      return []
    })
  }
  if (!ts.isIdentifier(expression)) return []
  if (seen.has(expression.text)) return []
  seen.add(expression.text)
  const resolved = localInitializers.get(expression.text)
  if (!resolved) return []
  if (ts.isArrayLiteralExpression(resolved)) return contextUseVariablesFromExpression(resolved, localInitializers, seen)
  return []
}

function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]) {
  return accesses.map((access) => ({
    type: access.kind === 'read' ? 'prompt.reads_memory' : 'prompt.writes_memory',
    typeByTargetKind:
      access.kind === 'read'
        ? {
            memory: 'prompt.reads_memory',
            blackboard: 'prompt.reads_blackboard',
            workspace: 'prompt.reads_workspace',
          }
        : {
            memory: 'prompt.writes_memory',
            blackboard: 'prompt.writes_blackboard',
            workspace: 'prompt.writes_workspace',
          },
    fromId,
    toVariable: access.targetVariable,
  }))
}
