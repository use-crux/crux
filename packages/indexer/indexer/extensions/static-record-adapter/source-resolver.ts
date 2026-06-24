import type { ProjectSourceRef, ProjectSourceRefRole, SourceLocation, SourceSnippet } from '@crux/core/project-index'
import type {
  StaticInitializerRecord,
  StaticObjectProperty,
  StaticObjectValue,
  StaticSyntaxFileRecord,
  StaticSyntaxValue,
} from '../../static/syntax-record/types'
import {
  createStaticSyntaxInitializerMap,
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
  type StaticSyntaxInitializerMap,
} from '../../static/syntax-record/value'

/** Resolved source evidence for an identifier or property path in a syntax record. */
export interface ResolvedStaticRecordSource {
  /** Syntax record that owns the resolved value. */
  readonly record: StaticSyntaxFileRecord
  /** Authored symbol or property path, for example `handler` or `fragments.extra`. */
  readonly symbol: string
  /** Normalized syntax value at the resolved source location. */
  readonly value: StaticSyntaxValue
  /** Source location to attach to the Project Source Ref. */
  readonly source: SourceLocation
  /** Snippet for the resolved value when available. */
  readonly snippet?: SourceSnippet
  /** Function name hint for function-like source refs. */
  readonly functionName?: string
  /** Initializers visible from the file that owns the resolved value. */
  readonly initializers: StaticSyntaxInitializerMap
  /** Initializer records visible from the file or function scope that owns the resolved value. */
  readonly initializerRecords?: readonly StaticInitializerRecord[]
}

/** Input required to resolve source refs from one syntax record context. */
export interface StaticRecordSourceResolverInput {
  /** Current syntax record. */
  readonly record: StaticSyntaxFileRecord
  /** Current file initializer lookup. */
  readonly initializers: StaticSyntaxInitializerMap
  /** Current match/file initializer records. */
  readonly initializerRecords?: readonly StaticInitializerRecord[]
  /** Already parsed records keyed by absolute file path. */
  readonly recordsByFile?: ReadonlyMap<string, StaticSyntaxFileRecord>
}

/** Creates a resolver for source refs backed entirely by normalized syntax records. */
export function createStaticRecordSourceResolver(input: StaticRecordSourceResolverInput) {
  return {
    resolveValue: (value: StaticSyntaxValue | undefined) => resolveValue(input, value),
    resolveFrom: (source: ResolvedStaticRecordSource, value: StaticSyntaxValue | undefined) =>
      resolveValue(
        {
          record: source.record,
          initializers: source.initializers,
          ...(source.initializerRecords ? { initializerRecords: source.initializerRecords } : {}),
          ...(input.recordsByFile ? { recordsByFile: input.recordsByFile } : {}),
        },
        value,
      ),
    sourceRef: (sourceInput: {
      readonly definitionId: string
      readonly role: ProjectSourceRefRole
      readonly property: string
      readonly resolved: ResolvedStaticRecordSource
      readonly metadata?: ProjectSourceRef['metadata']
    }) => staticRecordProjectSourceRef(sourceInput),
  }
}

function resolveValue(
  input: StaticRecordSourceResolverInput,
  value: StaticSyntaxValue | undefined,
): ResolvedStaticRecordSource | undefined {
  if (!value) return undefined
  if (value.kind === 'identifier') return resolveIdentifier(input, value.name)
  if (value.kind === 'property-access') return resolvePropertyAccess(input, value.path)
  return undefined
}

function resolveIdentifier(
  input: StaticRecordSourceResolverInput,
  symbol: string,
): ResolvedStaticRecordSource | undefined {
  const localInitializerRecords = input.initializerRecords ?? input.record.localInitializers
  const local = initializerRecord(localInitializerRecords, symbol)
  if (local) return resolvedFromInitializer(input.record, symbol, local, input.initializers, localInitializerRecords)

  const importRecord = input.record.imports.find((item) => item.localName === symbol)
  if (!importRecord?.resolvedFile || importRecord.importedName === 'default') return undefined
  const importedRecord = input.recordsByFile?.get(importRecord.resolvedFile)
  if (!importedRecord) return undefined
  const importedInitializers = createStaticSyntaxInitializerMap(importedRecord.localInitializers)
  const imported = initializerRecord(importedRecord.localInitializers, importRecord.importedName)
  return imported
    ? resolvedFromInitializer(importedRecord, symbol, imported, importedInitializers, importedRecord.localInitializers)
    : undefined
}

function resolvePropertyAccess(
  input: StaticRecordSourceResolverInput,
  path: readonly string[],
): ResolvedStaticRecordSource | undefined {
  const [root, ...properties] = path
  if (!root || properties.length === 0) return undefined
  const rootResolved = resolveIdentifier(input, root)
  if (!rootResolved) return undefined

  let current = resolveStaticSyntaxValue(rootResolved.value, rootResolved.initializers)
  let currentProperty: StaticObjectProperty | undefined
  for (const property of properties) {
    if (current?.kind !== 'object') return undefined
    currentProperty = current.properties.find((item) => !item.spread && item.name === property)
    current = currentProperty ? resolveStaticSyntaxValue(currentProperty.value, rootResolved.initializers) : undefined
  }
  if (!current || !currentProperty) return undefined
  return {
    record: rootResolved.record,
    symbol: path.join('.'),
    value: current,
    source: sourceForValue(current, currentProperty),
    ...(snippetForValue(current, undefined) ? { snippet: snippetForValue(current, undefined) } : {}),
    ...(current.kind === 'function' ? { functionName: path[path.length - 1] } : {}),
    initializers: rootResolved.initializers,
    ...(rootResolved.initializerRecords ? { initializerRecords: rootResolved.initializerRecords } : {}),
  }
}

/** Returns a named property value from an object and resolves identifier aliases. */
export function resolvedRecordObjectProperty(input: {
  readonly object: StaticObjectValue
  readonly property: string
  readonly initializers: StaticSyntaxInitializerMap
}): StaticSyntaxValue | undefined {
  return resolveStaticSyntaxValue(staticObjectPropertyValue(input.object, input.property), input.initializers)
}

/** Converts a resolved record source into the stable Project Source Ref contract. */
export function staticRecordProjectSourceRef(input: {
  readonly definitionId: string
  readonly role: ProjectSourceRefRole
  readonly property: string
  readonly resolved: ResolvedStaticRecordSource
  readonly metadata?: ProjectSourceRef['metadata']
}): ProjectSourceRef {
  return {
    id: `${input.definitionId}:source:${input.role}:${input.property}:${input.resolved.symbol}`,
    role: input.role,
    property: input.property,
    symbol: input.resolved.symbol,
    source: input.resolved.functionName
      ? { ...input.resolved.source, function: input.resolved.functionName }
      : input.resolved.source,
    ...(input.resolved.snippet ? { snippet: input.resolved.snippet } : {}),
    fidelity: 'resolved',
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

function resolvedFromInitializer(
  record: StaticSyntaxFileRecord,
  symbol: string,
  initializer: StaticInitializerRecord,
  initializers: StaticSyntaxInitializerMap,
  initializerRecords: readonly StaticInitializerRecord[],
): ResolvedStaticRecordSource {
  const value = resolveStaticSyntaxValue(initializer.value, initializers) ?? initializer.value
  return {
    record,
    symbol,
    value,
    source: value.kind === 'function' ? { ...initializer.source, function: symbol } : initializer.source,
    ...(snippetForValue(value, initializer) ? { snippet: snippetForValue(value, initializer) } : {}),
    ...(value.kind === 'function' ? { functionName: symbol } : {}),
    initializers,
    initializerRecords,
  }
}

function initializerRecord(
  records: readonly StaticInitializerRecord[],
  symbol: string,
): StaticInitializerRecord | undefined {
  return records.find((initializer) => initializer.name === symbol)
}

function sourceForValue(value: StaticSyntaxValue, property: StaticObjectProperty): SourceLocation {
  switch (value.kind) {
    case 'object':
    case 'call':
    case 'function':
    case 'unsupported':
      return value.source
    default:
      return property.source
  }
}

function snippetForValue(
  value: StaticSyntaxValue,
  initializer: StaticInitializerRecord | undefined,
): SourceSnippet | undefined {
  switch (value.kind) {
    case 'object':
    case 'call':
    case 'function':
      return value.snippet ?? initializer?.snippet
    default:
      return initializer?.snippet
  }
}
