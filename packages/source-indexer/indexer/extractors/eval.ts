import ts from 'typescript'
import { identifierArrayProperty, identifierProperty, propertyName, stringProperty } from '../ast/literals'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const evalExtractor: PrimitiveExtractor = {
  name: 'eval',
  capabilities: ['definition', 'relation', 'source', 'quality-join', 'partial'],
  callNames: ['evaluation', 'flowEvaluation', 'ragEvaluation', 'suite'],
  extract: (ctx) => {
    if (ctx.callName === 'evaluation' && ctx.objectArg) {
      const name = stringProperty(ctx.objectArg, 'name')
      const id = `eval.prompt:${ctx.safeId(name ?? ctx.variableName)}`
      const coverage = evalCoverageRefs(ctx.objectArg, 'prompt')
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'eval.prompt', name ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          covers: coverage.metadata,
        }),
        coverage.refs.map((target) => ({ type: 'eval.covers_definition', fromId: id, ...target })),
      )
    }
    if (ctx.callName === 'flowEvaluation' && ctx.objectArg) {
      const name = stringProperty(ctx.objectArg, 'name')
      const id = `eval.flow:${ctx.safeId(name ?? ctx.variableName)}`
      const coverage = evalCoverageRefs(ctx.objectArg, 'flow')
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'eval.flow', name ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          covers: coverage.metadata,
        }),
        coverage.refs.map((target) => ({ type: 'eval.covers_definition', fromId: id, ...target })),
      )
    }
    if (ctx.callName === 'ragEvaluation' && ctx.objectArg) {
      const name = stringProperty(ctx.objectArg, 'id') ?? stringProperty(ctx.objectArg, 'name')
      const id = `eval.rag:${ctx.safeId(name ?? ctx.variableName)}`
      const coverage = evalCoverageRefs(ctx.objectArg, 'rag')
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'eval.rag', name ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          covers: coverage.metadata,
        }),
        coverage.refs.map((target) => ({ type: 'eval.covers_definition', fromId: id, ...target })),
      )
    }
    if (ctx.callName === 'suite') {
      const explicitId = ctx.firstArg && ts.isStringLiteralLike(ctx.firstArg) ? ctx.firstArg.text : undefined
      const id = `suite:${ctx.safeId(explicitId ?? ctx.variableName)}`
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'suite', explicitId ?? ctx.variableName, undefined, {
          exportName: ctx.variableName,
          source: 'code',
        }),
      )
    }
    return undefined
  },
}

function evalCoverageRefs(
  object: ts.ObjectLiteralExpression,
  defaultField: 'prompt' | 'flow' | 'rag',
): {
  refs: Array<{ toVariable?: string; toId?: string }>
  metadata?: string[]
} {
  const fields = [defaultField, 'target', 'targets', 'definition', 'definitions', 'covers'] as const
  const refs: Array<{ toVariable?: string; toId?: string }> = []
  const metadata: string[] = []
  for (const field of fields) {
    const single = identifierProperty(object, field)
    if (single) {
      refs.push({ toVariable: single })
      metadata.push(single)
    }
    for (const item of identifierArrayProperty(object, field)) {
      refs.push({ toVariable: item })
      metadata.push(item)
    }
    for (const item of stringArrayProperty(object, field)) {
      refs.push({ toId: item.includes(':') ? item : undefined, toVariable: item.includes(':') ? undefined : item })
      metadata.push(item)
    }
  }
  return { refs, metadata: metadata.length > 0 ? metadata : undefined }
}

function stringArrayProperty(object: ts.ObjectLiteralExpression, name: string): string[] {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return []
  return property.initializer.elements
    .filter((element): element is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => ts.isStringLiteralLike(element))
    .map((element) => element.text)
}
