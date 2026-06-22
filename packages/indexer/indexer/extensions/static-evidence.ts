import { createStaticRecordObjectReader } from '../static/syntax-record/readers'
import type {
  StaticFunctionCallValue,
  StaticFunctionValue,
  StaticObjectValue,
  StaticSourceMatch,
  StaticSyntaxFileRecord,
  StaticSyntaxValue,
} from '../static/syntax-record/types'
import {
  createStaticSyntaxInitializerMap,
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
  type StaticSyntaxInitializerMap,
} from '../static/syntax-record/value'
import type {
  StaticCallbackSummary,
  StaticCallbackSummaryInput,
  StaticConstructorEvidenceQuery,
  StaticEvidenceReader,
  StaticMatchEvidence,
  StaticCallEvidenceQuery,
} from './evidence-types'

/** Input for creating a bounded evidence reader over one syntax record. */
export interface StaticRecordEvidenceReaderInput {
  /** Project root used for deterministic evidence ids. */
  readonly root: string
  /** Backend-neutral syntax record to expose through AST-free evidence queries. */
  readonly record: StaticSyntaxFileRecord
}

interface EvidenceEntry {
  readonly evidence: StaticMatchEvidence
  readonly match: StaticSourceMatch
  readonly object: StaticObjectValue | undefined
  readonly initializers: StaticSyntaxInitializerMap
}

/** Creates an AST-free evidence reader for a backend-neutral syntax record. */
export function createStaticRecordEvidenceReader(input: StaticRecordEvidenceReaderInput): StaticEvidenceReader {
  const entries = input.record.matches.map((match, index) => evidenceEntry(input.root, input.record, match, index))
  const entriesById = new Map(entries.map((entry) => [entry.evidence.id, entry]))

  return {
    calls: (query = {}) =>
      entries
        .filter((entry) => entry.match.kind === 'call' && calleeMatches(entry.match, query))
        .map((entry) => entry.evidence),
    constructors: (query = {}) =>
      entries
        .filter((entry) => entry.match.kind === 'new' && calleeMatches(entry.match, query))
        .map((entry) => entry.evidence),
    config: (evidenceId) => {
      const entry = entriesById.get(evidenceId)
      return entry?.object ? createStaticRecordObjectReader(entry.object, entry.initializers) : undefined
    },
    callbackSummary: (summaryInput) => callbackSummary(entriesById.get(summaryInput.evidenceId), summaryInput),
  }
}

function evidenceEntry(
  root: string,
  record: StaticSyntaxFileRecord,
  match: StaticSourceMatch,
  index: number,
): EvidenceEntry {
  const initializers = createStaticSyntaxInitializerMap([
    ...record.localInitializers,
    ...(match.localInitializers ?? []),
  ])
  const object = match.kind === 'object' ? match.object : match.objectArg
  return {
    evidence: {
      id: `${relativeEvidenceFile(root, record.file)}#${index}:${match.kind}:${match.variableName}`,
      kind: match.kind,
      file: record.file,
      variableName: match.variableName,
      localName: match.localName,
      exported: match.exported,
      ...(match.kind === 'object' ? {} : { callee: match.callee, args: match.args }),
      source: match.source,
      ...(match.snippet ? { snippet: match.snippet } : {}),
    },
    match,
    object,
    initializers,
  }
}

function relativeEvidenceFile(root: string, file: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedFile = file.replace(/\\/g, '/')
  const prefix = normalizedRoot ? `${normalizedRoot}/` : '/'
  return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : normalizedFile
}

function calleeMatches(
  match: StaticSourceMatch,
  query: StaticCallEvidenceQuery | StaticConstructorEvidenceQuery,
): boolean {
  if (match.kind === 'object') return false
  if (query.name && match.callee.name !== query.name) return false
  if (query.importFrom && !query.importFrom.includes(match.callee.moduleSpecifier ?? '')) return false
  return true
}

function callbackSummary(
  entry: EvidenceEntry | undefined,
  input: StaticCallbackSummaryInput,
): StaticCallbackSummary | undefined {
  if (!entry?.object) return undefined
  const value = staticObjectPropertyValue(entry.object, input.property)
  const resolved = resolveStaticSyntaxValue(value, entry.initializers)
  if (resolved?.kind !== 'function') return undefined
  return {
    property: input.property,
    calls: collectFunctionCalls(resolved, entry.initializers, input.maxDepth ?? 1),
    returns: resolved.returns,
    source: resolved.source,
    ...(resolved.snippet ? { snippet: resolved.snippet } : {}),
  }
}

function collectFunctionCalls(
  value: StaticFunctionValue,
  initializers: StaticSyntaxInitializerMap,
  maxDepth: number,
): readonly StaticFunctionCallValue[] {
  if (maxDepth <= 1) return value.calls
  return collectCalls(value.calls, initializers, new Set(), maxDepth - 1)
}

function collectCalls(
  calls: readonly StaticFunctionCallValue[],
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
  depth: number,
): readonly StaticFunctionCallValue[] {
  if (depth <= 0) return calls
  return calls.flatMap((call): readonly StaticFunctionCallValue[] => {
    const helper = helperFunction(call, initializers, seen)
    return helper ? [call, ...collectCalls(helper.calls, initializers, seen, depth - 1)] : [call]
  })
}

function helperFunction(
  call: StaticFunctionCallValue,
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
): StaticFunctionValue | undefined {
  const symbol = helperSymbol(call)
  if (!symbol || seen.has(symbol)) return undefined
  seen.add(symbol)
  const value: StaticSyntaxValue = { kind: 'identifier', name: symbol }
  const resolved = resolveStaticSyntaxValue(value, initializers)
  return resolved?.kind === 'function' ? resolved : undefined
}

function helperSymbol(call: StaticFunctionCallValue): string | undefined {
  if (call.receiver) return undefined
  return call.callee.localName ?? call.callee.name
}
