import ts from 'typescript'
import { identifierArrayProperty, identifierProperty, propertyName, stringProperty } from '../ast/literals'
import { callbackSourceRefForProperty } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const safetyExtractor: PrimitiveExtractor = {
  name: 'safety',
  capabilities: ['definition', 'source', 'runtime-join', 'partial'],
  callNames: ['constraint', 'guardrail'],
  extract: (ctx) => {
    if (!ctx.objectArg) return undefined
    if (ctx.callName === 'constraint') {
      const explicitName = stringProperty(ctx.objectArg, 'name')
      const id = `constraint:${ctx.safeId(explicitName ?? ctx.localName)}`
      const targets = appliesToRefs(ctx.objectArg)
      const sourceRefs = ['check', 'run', 'validate', 'evaluate']
        .map((property) => callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg!, property, role: 'validator', definitionId: id }))
        .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      return foundDefinition(
        ctx.variableName,
        {
          ...ctx.define(id, 'constraint', explicitName ?? ctx.variableName, ctx.objectArg, {
            exportName: ctx.variableName,
            severity: stringProperty(ctx.objectArg, 'severity'),
            appliesTo: targets.metadata,
          }),
          ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
        },
        targets.refs.map((target) => ({
          type: 'constraint.applies_to',
          fromId: id,
          ...target,
        })),
      )
    }
    if (ctx.callName === 'guardrail') {
      const explicitName = stringProperty(ctx.objectArg, 'name')
      const id = `guardrail:${ctx.safeId(explicitName ?? ctx.localName)}`
      const targets = appliesToRefs(ctx.objectArg)
      const sourceRefs = ['check', 'run', 'validate', 'evaluate']
        .map((property) => callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg!, property, role: 'policy', definitionId: id }))
        .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
      return foundDefinition(
        ctx.variableName,
        {
          ...ctx.define(id, 'guardrail', explicitName ?? ctx.variableName, ctx.objectArg, {
            exportName: ctx.variableName,
            phase: stringProperty(ctx.objectArg, 'phase'),
            appliesTo: targets.metadata,
          }),
          ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
        },
        targets.refs.map((target) => ({
          type: 'guardrail.applies_to',
          fromId: id,
          ...target,
        })),
      )
    }
    return undefined
  },
}

function appliesToRefs(object: ts.ObjectLiteralExpression): {
  refs: Array<{ toVariable?: string; toId?: string }>
  metadata?: string[]
} {
  const names = ['appliesTo', 'target', 'targets', 'for']
  const refs: Array<{ toVariable?: string; toId?: string }> = []
  const metadata: string[] = []
  for (const name of names) {
    const single = identifierProperty(object, name)
    if (single) {
      refs.push({ toVariable: single })
      metadata.push(single)
    }
    for (const item of identifierArrayProperty(object, name)) {
      refs.push({ toVariable: item })
      metadata.push(item)
    }
    for (const item of stringArrayProperty(object, name)) {
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
