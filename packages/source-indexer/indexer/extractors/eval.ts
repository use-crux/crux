import ts from 'typescript'
import type { ProjectDefinition } from '@crux/core/catalog'
import { identifierArrayProperty, identifierProperty, propertyName, stringProperty } from '../ast/literals'
import { foldedCatalogChild } from '../catalog-presentation'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const evalExtractor: PrimitiveExtractor = {
  name: 'eval',
  capabilities: ['definition', 'relation', 'source', 'quality-join', 'partial'],
  callNames: ['evaluation', 'flowEvaluation', 'ragEvaluation', 'ragDataset', 'suite'],
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
      const cases = staticSuiteCases(ctx, id, explicitId ?? ctx.variableName)
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'suite', explicitId ?? ctx.variableName, undefined, {
          exportName: ctx.variableName,
          source: 'code',
          ...(cases.length > 0 ? { caseCount: cases.length } : {}),
          facts: {
            kind: 'suite',
            ...(cases.length > 0 ? { caseCount: cases.length } : {}),
          },
        }),
        cases.map((testCase) => ({
          type: 'suite.includes_case',
          fromId: id,
          toId: testCase.definition.id,
        })),
        cases.map((testCase) => testCase.definition),
      )
    }
    if (ctx.callName === 'ragDataset' && ctx.objectArg) {
      const explicitId = stringProperty(ctx.objectArg, 'id')
      const caseCount = arrayPropertyLength(ctx.objectArg, 'cases', ctx.localInitializers)
      const id = `dataset:${ctx.safeId(explicitId ?? ctx.variableName)}`
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'dataset', explicitId ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          ...(caseCount === undefined ? {} : { caseCount }),
          facts: {
            kind: 'dataset',
            ...(caseCount === undefined ? {} : { caseCount }),
          },
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

function staticSuiteCases(ctx: Parameters<PrimitiveExtractor['extract']>[0], suiteId: string, suiteName: string): Array<{ definition: ProjectDefinition }> {
  const callback = ctx.call.arguments[1]
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return []
  const testParam = callback.parameters[0]?.name
  if (!testParam || !ts.isIdentifier(testParam)) return []
  const cases: Array<{ definition: ProjectDefinition }> = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === testParam.text) {
      const firstArg = node.arguments[0]
      if (firstArg && ts.isStringLiteralLike(firstArg)) {
        const caseId = ctx.safeId(firstArg.text)
        cases.push({
          definition: ctx.define(`suite.case:${ctx.safeId(suiteName)}:${caseId}`, 'suite.case', firstArg.text, undefined, {
            suiteId: suiteName,
            caseId,
            facts: {
              kind: 'suite.case',
              suiteId: suiteName,
            },
            catalogPresentation: foldedCatalogChild({
              parentDefinitionId: suiteId,
              parentRelationType: 'suite.includes_case',
              role: 'case',
              order: cases.length,
            }),
          }),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(callback.body, visit)
  return cases
}

function arrayPropertyLength(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): number | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  const initializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
  const resolved = ts.isIdentifier(initializer) ? localInitializers.get(initializer.text) ?? initializer : initializer
  return ts.isArrayLiteralExpression(resolved) ? resolved.elements.length : undefined
}
