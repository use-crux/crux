import type { ProjectSourceRef } from '@use-crux/core/project-index'
import type { ExtractContext, ExtractedFacts } from '../extensions'
import { internalStaticRecordContext, type InternalStaticRecordContext } from '../static-index/compatibility/syntax-record-bridge/native-context'
import {
  createStaticRecordSourceResolver,
  staticRecordProjectSourceRef,
  type ResolvedStaticRecordSource,
} from '../static-index/compatibility/syntax-record-bridge/source-resolver'
import type {
  StaticFunctionCallValue,
  StaticFunctionValue,
  StaticObjectValue,
  StaticSyntaxValue,
} from '../static-index/syntax/record/types'
import {
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
  staticObjectValue,
  type StaticSyntaxInitializerMap,
} from '../static-index/syntax/record/value'
import type { PrimitiveDataAccessRef } from './data-access'
import { flowFactsFromEvidence, type FlowStepEvidence, type FlowSuspensionEvidence } from './flow-facts'

/** Projects `flow(...)` syntax records into immutable index facts. */
export function flowFactsFromStaticRecordContext(ctx: ExtractContext): ExtractedFacts | undefined {
  const recordCtx = internalStaticRecordContext(ctx)
  if (!recordCtx || (ctx.match.name !== 'flow' && ctx.match.name !== 'cruxFlow')) return undefined
  if (recordCtx.match.kind !== 'call') return undefined
  const explicitName = ctx.args.string(0) ?? ctx.config?.string('name')
  return flowFactsFromEvidence({
    variableName: ctx.source.variableName,
    localName: ctx.source.localName,
    callName: ctx.match.name,
    runtime: recordFlowRuntime(recordCtx),
    explicitName,
    args: recordArgsKeys(recordCtx),
    argsSchema: ctx.config?.schema('args') as Record<string, unknown> | undefined,
    hasArgs: ctx.config?.has('args') ?? false,
    traversal: recordFlowTraversal(recordCtx, explicitName ?? ctx.source.localName, ctx.source.safeId),
    safeId: ctx.source.safeId,
    define: (id, kind, name, metadata) =>
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind,
        name,
        metadata,
      }).definition,
  })
}

function recordFlowRuntime(ctx: InternalStaticRecordContext): 'convex' | 'node' {
  if (ctx.match.kind !== 'call') return 'node'
  const callee = ctx.match.callee
  return callee.localName === 'cruxFlow' || callee.moduleSpecifier?.startsWith('@use-crux/convex') ? 'convex' : 'node'
}

function recordFlowTraversal(
  ctx: InternalStaticRecordContext,
  flowDefinitionKey: string,
  safeId: (value: string) => string,
) {
  const roots = flowFunctionRoots(ctx)
  const steps = roots.flatMap((root) =>
    root.calls.flatMap((call) => flowStepRefForCall(ctx, flowDefinitionKey, safeId, call)),
  )
  const stepNames = [...new Set(steps.map((step) => step.name))]
  return {
    steps,
    suspensions: flowSuspensionRefs(roots, stepNames[stepNames.length - 1]),
  }
}

function flowFunctionRoots(ctx: InternalStaticRecordContext): readonly StaticFunctionValue[] {
  if (ctx.match.kind !== 'call') return []
  if (ctx.objectArg) {
    return functionValues(staticObjectPropertyValue(ctx.objectArg, 'handler'), ctx.initializers)
  }
  return ctx.match.args.slice(1).flatMap((arg) => functionValues(arg, ctx.initializers))
}

function functionValues(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): readonly StaticFunctionValue[] {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  return resolved?.kind === 'function' ? [resolved] : []
}

function flowStepRefForCall(
  ctx: InternalStaticRecordContext,
  flowDefinitionKey: string,
  safeId: (value: string) => string,
  call: StaticFunctionCallValue,
): readonly FlowStepEvidence[] {
  if (call.callee.name !== 'step') return []
  const name = literalString(call.args[0])
  if (!name) return []
  const target = call.args[1]
  const targetVariable = target?.kind === 'identifier' ? target.name : undefined
  const stepDefinitionId = `flow.step:${safeId(flowDefinitionKey)}:${safeId(name)}`
  return [{
    name,
    ...(targetVariable ? { targetVariable } : {}),
    dataAccesses: target ? dataAccessesForStepTarget(target, ctx.initializers) : [],
    sourceRefs: targetVariable ? sourceRefsForTarget(ctx, stepDefinitionId, targetVariable) : [],
  }]
}

function flowSuspensionRefs(
  roots: readonly StaticFunctionValue[],
  fallbackStepName: string | undefined,
): readonly FlowSuspensionEvidence[] {
  const refs: FlowSuspensionEvidence[] = []
  let currentStepName: string | undefined
  for (const root of roots) {
    for (const call of root.calls) {
      currentStepName = flowStepName(call) ?? currentStepName
      const suspension = flowSuspensionForCall(call, currentStepName ?? fallbackStepName)
      if (suspension) refs.push(suspension)
    }
  }
  return refs
}

function flowStepName(call: StaticFunctionCallValue): string | undefined {
  return call.callee.name === 'step' ? literalString(call.args[0]) : undefined
}

function flowSuspensionForCall(
  call: StaticFunctionCallValue,
  stepName: string | undefined,
): FlowSuspensionEvidence | undefined {
  const signal = literalString(call.args[0])
  return signal && (call.callee.name === 'waitFor' || call.callee.name === 'suspend')
    ? { signal, ...(stepName ? { stepName } : {}) }
    : undefined
}

function recordArgsKeys(ctx: InternalStaticRecordContext): readonly string[] | undefined {
  if (!ctx.objectArg) return undefined
  const args = staticObjectValue(staticObjectPropertyValue(ctx.objectArg, 'args'), ctx.initializers)
  const keys = args?.properties.flatMap((property) => (property.spread ? [] : [property.name]))
  return keys && keys.length > 0 ? keys : undefined
}

function dataAccessesForStepTarget(
  target: StaticSyntaxValue,
  initializers: StaticSyntaxInitializerMap,
): readonly PrimitiveDataAccessRef[] {
  const resolved = resolveStaticSyntaxValue(target, initializers)
  return resolved?.kind === 'function'
    ? [
        ...dataAccessRefsFromCalls(resolved.calls),
        ...helperDataAccessRefsFromCalls(resolved.calls, initializers, new Set(), 1),
      ]
    : []
}

function dataAccessRefsFromCalls(calls: readonly StaticFunctionCallValue[]): readonly PrimitiveDataAccessRef[] {
  return calls.flatMap((call): readonly PrimitiveDataAccessRef[] => {
    const kind = dataAccessKind(call.callee.name)
    const targetVariable = receiverIdentifier(call.receiver)
    if (!kind || !targetVariable) return []
    const key = dataAccessKey(call.args[0])
    return [{
      kind,
      targetVariable,
      operation: dataAccessOperation(call.callee.name, kind),
      targetKind: dataAccessTargetKind(targetVariable),
      ...(key ? { key } : {}),
      source: call.source,
    }]
  })
}

function helperDataAccessRefsFromCalls(
  calls: readonly StaticFunctionCallValue[],
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
  depth: number,
): readonly PrimitiveDataAccessRef[] {
  if (depth <= 0) return []
  return calls.flatMap((call): readonly PrimitiveDataAccessRef[] => {
    const symbol = call.receiver ? undefined : (call.callee.localName ?? call.callee.name)
    if (!symbol || seen.has(symbol)) return []
    seen.add(symbol)
    const resolved = resolveStaticSyntaxValue({ kind: 'identifier', name: symbol }, initializers)
    if (resolved?.kind !== 'function') return []
    return [
      ...dataAccessRefsFromCalls(resolved.calls),
      ...helperDataAccessRefsFromCalls(resolved.calls, initializers, seen, depth - 1),
    ]
  })
}

function sourceRefsForTarget(
  ctx: InternalStaticRecordContext,
  definitionId: string,
  targetVariable: string,
): readonly ProjectSourceRef[] {
  const resolver = createStaticRecordSourceResolver({
    record: ctx.record,
    initializers: ctx.initializers,
    initializerRecords: ctx.initializerRecords,
    ...(ctx.recordsByFile ? { recordsByFile: ctx.recordsByFile } : {}),
  })
  const resolved = resolver.resolveValue({ kind: 'identifier', name: targetVariable })
  if (!resolved) return []
  return [
    staticRecordProjectSourceRef({
      definitionId,
      role: 'handler',
      property: 'step',
      resolved,
    }),
    ...helperSourceRefsForResolvedTarget(resolver, definitionId, resolved),
  ]
}

function helperSourceRefsForResolvedTarget(
  resolver: ReturnType<typeof createStaticRecordSourceResolver>,
  definitionId: string,
  resolved: ResolvedStaticRecordSource,
): readonly ProjectSourceRef[] {
  if (resolved.value.kind !== 'function') return []
  const seen = new Set<string>()
  return resolved.value.calls.flatMap((call): readonly ProjectSourceRef[] => {
    const symbol = call.receiver ? undefined : (call.callee.localName ?? call.callee.name)
    if (!symbol || seen.has(symbol)) return []
    seen.add(symbol)
    const helper = resolver.resolveFrom(resolved, { kind: 'identifier', name: symbol })
    if (!helper || helper.value.kind !== 'function') return []
    return [
      staticRecordProjectSourceRef({
        definitionId,
        role: 'helper',
        property: symbol,
        resolved: helper,
      }),
    ]
  })
}

function receiverIdentifier(value: StaticSyntaxValue | undefined): string | undefined {
  return value?.kind === 'identifier' ? value.name : undefined
}

function literalString(value: StaticSyntaxValue | undefined): string | undefined {
  return value?.kind === 'literal' && typeof value.value === 'string' ? value.value : undefined
}

function dataAccessKey(value: StaticSyntaxValue | undefined): string | undefined {
  if (value?.kind !== 'literal') return undefined
  return typeof value.value === 'string' || typeof value.value === 'number' ? String(value.value) : undefined
}

function dataAccessKind(method: string): 'read' | 'write' | undefined {
  if (['get', 'read', 'query', 'find', 'search', 'list', 'readFile', 'load'].includes(method)) return 'read'
  if (['set', 'write', 'update', 'append', 'delete', 'put', 'writeFile', 'edit', 'deleteFile', 'save'].includes(method)) {
    return 'write'
  }
  return undefined
}

function dataAccessOperation(
  method: string,
  kind: 'read' | 'write',
): NonNullable<PrimitiveDataAccessRef['operation']> {
  if (['query', 'find', 'search', 'list'].includes(method)) return 'query'
  if (['append', 'put', 'save'].includes(method)) return 'append'
  if (['update', 'edit'].includes(method)) return 'update'
  if (['delete', 'deleteFile'].includes(method)) return 'delete'
  return kind
}

function dataAccessTargetKind(targetVariable: string): NonNullable<PrimitiveDataAccessRef['targetKind']> | undefined {
  const normalized = targetVariable.toLowerCase()
  if (normalized.includes('blackboard') || normalized.includes('board')) return 'blackboard'
  if (normalized.includes('workspace') || normalized.includes('file') || normalized.includes('fs')) return 'workspace'
  if (normalized.includes('store')) return 'store'
  if (normalized.includes('block')) return 'block'
  if (normalized.includes('memory') || normalized.includes('mem') || normalized.includes('state')) return 'memory'
  return undefined
}
