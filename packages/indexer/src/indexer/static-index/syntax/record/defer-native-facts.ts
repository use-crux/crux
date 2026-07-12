import { createHash } from 'node:crypto'
import type { ProjectDefinition, ProjectSourceRef } from '@use-crux/core/project-index'
import { fingerprint, safeId } from '../../../definitions'
import type { StaticCallSourceMatch, StaticNativeFactProjection, StaticSourceMatch, StaticSyntaxValue } from './types'

/** Projects public defer calls through the TypeScript syntax frontend with Rust/Oxc-identical facts. */
export function typeScriptDeferNativeFacts(
  file: string,
  relativePath: string,
  sourceText: string,
  matches: readonly StaticSourceMatch[],
): readonly StaticNativeFactProjection[] {
  let ordinal = 0
  return matches.flatMap((match, matchIndex) => {
    if (!isPublicDeferCall(match)) return []
    ordinal += 1
    return [deferProjection(file, relativePath, sourceText, match, matchIndex, ordinal)]
  })
}

function deferProjection(
  file: string,
  relativePath: string,
  sourceText: string,
  match: StaticCallSourceMatch,
  matchIndex: number,
  ordinal: number,
): StaticNativeFactProjection {
  const named = match.args.length > 1
  const mode = named ? 'named' : 'inline'
  const id = `deferred-work:${mode}:${safeId(relativePath)}:${sha256(relativePath).slice(0, 16)}:${ordinal}`
  const name = `${mode} deferred work`
  const target = named ? identifier(match.args[0]) : undefined
  const sourceLines = sourceText.split(/\r?\n/)
  const sourceLine = sourceLines[match.source.line - 1] ?? ''
  const beforeCall = [
    ...sourceLines.slice(0, match.source.line - 1),
    sourceLine.slice(0, Math.max(0, (match.source.column ?? 1) - 1)),
  ]
    .join('\n')
    .slice(-512)
  const metadata = {
    runtimeJoin: { definitionId: id, kind: 'deferred-work' as const, name, spanAttributes: {} },
    mode,
    indexPresentation: { standalone: true },
    facts: { kind: 'deferred-work' as const, mode },
    relativePath,
    callOrdinal: ordinal,
    consumed: isConsumed(beforeCall),
    eagerExecution: match.eagerExecution ?? false,
    ...(target ? { target } : {}),
    static: true,
  }
  const definition: ProjectDefinition = {
    id,
    kind: 'deferred-work',
    name,
    source: match.source,
    ...(match.snippet ? { sourceSnippet: match.snippet } : {}),
    fidelity: 'resolved',
    status: 'active',
    fingerprint: fingerprint({
      kind: 'deferred-work',
      name,
      file,
      ...(match.snippet ? { text: match.snippet.source } : {}),
    }),
    metadata,
  }
  const callbackSymbol = !named ? identifier(match.args[0]) ?? 'inline' : undefined
  return {
    matchIndex,
    replaces: [{ extension: '@use-crux/indexer/crux-core', extractor: 'defer' }],
    facts: {
      definitions: [{ variableName: `defer_${ordinal}`, definition }],
      references: target ? [{ type: 'defer.targets_task', fromId: id, toVariable: target }] : [],
      sourceRefs: callbackSymbol ? [callbackSourceRef(id, callbackSymbol, match)] : [],
    },
  }
}

function callbackSourceRef(
  definitionId: string,
  symbol: string,
  match: StaticCallSourceMatch,
): { readonly definitionId: string; readonly ref: ProjectSourceRef } {
  return {
    definitionId,
    ref: {
      id: `${definitionId}:source:callback:callback:${symbol}`,
      role: 'callback',
      property: 'callback',
      symbol,
      source: { ...match.source, ...(symbol !== 'inline' ? { function: symbol } : {}) },
      ...(match.snippet ? { snippet: match.snippet } : {}),
      fidelity: 'resolved',
    },
  }
}

function isPublicDeferCall(match: StaticSourceMatch): match is StaticCallSourceMatch {
  return (
    match.kind === 'call' &&
    match.callee.name === 'defer' &&
    match.callee.direct !== false &&
    match.callee.moduleSpecifier === '@use-crux/core'
  )
}

function identifier(value: StaticSyntaxValue | undefined): string | undefined {
  return value?.kind === 'identifier' ? value.name : undefined
}

function isConsumed(beforeCall: string): boolean {
  const expression = beforeCall.split(/[;{}]/).at(-1) ?? ''
  return /(?:\bawait\s|\breturn\s|Promise\.(?:all|allSettled|race|any)\s*\()/.test(expression)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
