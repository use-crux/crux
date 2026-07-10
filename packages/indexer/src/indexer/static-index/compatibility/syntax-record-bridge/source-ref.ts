import type { ProjectSourceRef, ProjectSourceRefRole } from '@use-crux/core/project-index'
import type { ExtractedSourceRef, SourceRefBuilder } from '../../../extensions/public-contract/types'
import type {
  StaticFunctionCallValue,
  StaticInitializerRecord,
  StaticObjectValue,
  StaticSyntaxFileRecord,
  StaticSyntaxValue,
} from '../../syntax/record/types'
import { resolveStaticSyntaxValue, staticObjectPropertyValue } from '../../syntax/record/value'
import {
  createStaticRecordSourceResolver,
  resolvedRecordObjectProperty,
  staticRecordProjectSourceRef,
} from './source-resolver'
import { schemaPropertySourceRefs } from './schema-source-ref'

/** Input for source refs created from backend-neutral syntax records. */
export interface StaticRecordSourceRefBuilderInput {
  /** Syntax record that owns the current extractor context. */
  readonly record: StaticSyntaxFileRecord
  /** Selected object/config argument for the current extractor. */
  readonly object?: StaticObjectValue
  /** Source-local initializer records from the owning syntax file. */
  readonly initializers: readonly StaticInitializerRecord[]
  /** Already parsed records keyed by absolute file path for direct import source refs. */
  readonly recordsByFile?: ReadonlyMap<string, StaticSyntaxFileRecord>
}

/** Creates source-ref helpers backed by syntax-record source locations. */
export function createStaticRecordSourceRefBuilder(input: StaticRecordSourceRefBuilderInput): SourceRefBuilder {
  const initializerValues = new Map(input.initializers.map((initializer) => [initializer.name, initializer.value]))
  const resolver = createStaticRecordSourceResolver({
    record: input.record,
    initializers: initializerValues,
    initializerRecords: input.initializers,
    ...(input.recordsByFile ? { recordsByFile: input.recordsByFile } : {}),
  })
  return {
    property: ({ property, role, definitionId, metadata }) =>
      sourceRefForProperty({
        object: input.object,
        resolver,
        property,
        role,
        definitionId,
        ...(metadata ? { metadata } : {}),
      }),
    callbackProperty: ({ property, role, definitionId, metadata }) =>
      sourceRefForProperty({
        object: input.object,
        resolver,
        property,
        role,
        definitionId,
        requireFunction: true,
        ...(metadata ? { metadata } : {}),
      }),
    templateInterpolations: ({ property, role, definitionId }) =>
      templateInterpolationSourceRefs({
        object: input.object,
        resolver,
        initializerValues,
        property,
        role,
        definitionId,
      }),
    schemaProperty: ({ property, definitionId }) =>
      schemaPropertySourceRefs({
        object: input.object,
        resolver,
        initializerValues,
        property,
        definitionId,
      }),
    helperRefsForProperty: ({ property, definitionId, maxDepth }) =>
      helperRefsForProperty({
        object: input.object,
        resolver,
        initializerValues,
        property,
        definitionId,
        maxDepth: maxDepth ?? 1,
      }),
  }
}

function sourceRefForProperty(input: {
  readonly object?: StaticObjectValue
  readonly resolver: ReturnType<typeof createStaticRecordSourceResolver>
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly definitionId: string
  readonly requireFunction?: boolean
  readonly metadata?: ProjectSourceRef['metadata']
}): ExtractedSourceRef | undefined {
  if (!input.object) return undefined
  const resolved = input.resolver.resolveValue(staticObjectPropertyValue(input.object, input.property))
  if (!resolved) return undefined
  if (input.requireFunction && resolved.value.kind !== 'function') return undefined
  return {
    definitionId: input.definitionId,
    ref: input.resolver.sourceRef({
      definitionId: input.definitionId,
      role: input.role,
      property: input.property,
      resolved,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    }),
  }
}

function templateInterpolationSourceRefs(input: {
  readonly object?: StaticObjectValue
  readonly resolver: ReturnType<typeof createStaticRecordSourceResolver>
  readonly initializerValues: ReadonlyMap<string, StaticSyntaxValue>
  readonly property: string
  readonly role: ProjectSourceRefRole
  readonly definitionId: string
}): readonly ExtractedSourceRef[] {
  const value = input.object
    ? resolvedRecordObjectProperty({
        object: input.object,
        property: input.property,
        initializers: input.initializerValues,
      }) ?? staticObjectPropertyValue(input.object, input.property)
    : undefined
  if (value?.kind !== 'template') return []
  const seen = new Set<string>()
  return value.expressions.flatMap((expression): readonly ExtractedSourceRef[] => {
    const resolved = input.resolver.resolveValue(expression)
    if (!resolved || seen.has(resolved.symbol)) return []
    seen.add(resolved.symbol)
    return [{
      definitionId: input.definitionId,
      ref: input.resolver.sourceRef({
        definitionId: input.definitionId,
        role: input.role,
        property: input.property,
        resolved,
        metadata: { injected: true, fragment: isFragmentLike(resolved.value) },
      }),
    }]
  })
}

function helperRefsForProperty(input: {
  readonly object?: StaticObjectValue
  readonly resolver: ReturnType<typeof createStaticRecordSourceResolver>
  readonly initializerValues: ReadonlyMap<string, StaticSyntaxValue>
  readonly property: string
  readonly definitionId: string
  readonly maxDepth: number
}): readonly ExtractedSourceRef[] {
  if (!input.object) return []
  const value = staticObjectPropertyValue(input.object, input.property)
  const resolved = input.resolver.resolveValue(value)
  const root = resolved?.value ?? resolveStaticSyntaxValue(value, input.initializerValues)
  return collectHelperRefs({
    resolver: input.resolver,
    calls: helperCalls(root),
    definitionId: input.definitionId,
    seen: new Set(),
    depth: input.maxDepth,
  })
}

function collectHelperRefs(input: {
  readonly resolver: ReturnType<typeof createStaticRecordSourceResolver>
  readonly calls: readonly StaticFunctionCallValue[]
  readonly definitionId: string
  readonly seen: Set<string>
  readonly depth: number
}): readonly ExtractedSourceRef[] {
  if (input.depth <= 0) return []
  return input.calls.flatMap((call): readonly ExtractedSourceRef[] => {
    const symbol = helperCallSymbol(call)
    if (!symbol || input.seen.has(symbol)) return []
    input.seen.add(symbol)
    const resolved = input.resolver.resolveValue({ kind: 'identifier', name: symbol })
    if (!resolved || resolved.value.kind !== 'function') return []
    return [
      {
        definitionId: input.definitionId,
        ref: staticRecordProjectSourceRef({
          definitionId: input.definitionId,
          role: 'helper',
          property: symbol,
          resolved,
        }),
      },
      ...collectHelperRefs({
        ...input,
        calls: resolved.value.calls,
        depth: input.depth - 1,
      }),
    ]
  })
}

function helperCalls(value: StaticSyntaxValue | undefined): readonly StaticFunctionCallValue[] {
  if (!value) return []
  if (value.kind === 'function') return value.calls
  if (value.kind === 'call') {
    return [{
      callee: value.callee,
      ...(value.receiver ? { receiver: value.receiver } : {}),
      args: value.args,
      source: value.source,
      ...(value.snippet ? { snippet: value.snippet } : {}),
    }]
  }
  return []
}

function helperCallSymbol(call: StaticFunctionCallValue): string | undefined {
  if (call.receiver) return undefined
  return call.callee.localName ?? call.callee.name
}

function isFragmentLike(value: StaticSyntaxValue): boolean {
  return value.kind === 'literal' && typeof value.value === 'string' || value.kind === 'template'
}
