import type ts from 'typescript'
import type { StaticCallContext } from '../extractors/types'
import type { ExtractContext } from './types'

/**
 * Compiler-owned TypeScript payload carried for first-party migration helpers.
 *
 * This is intentionally narrower than the full parser context and remains internal to the source
 * indexer. Stable extension authors should use readers/builders on `ExtractContext` instead.
 */
export interface InternalTypeScriptContext {
  readonly sourceFile: ts.SourceFile
  readonly call: ts.Expression
  readonly objectArg?: ts.ObjectLiteralExpression
}

/**
 * Reads the parser-native static call context from the first-party escape hatch.
 *
 * Centralizing this access keeps `unstableNative` out of individual extractors/helpers and makes the
 * remaining TypeScript-native islands easy to audit.
 */
export function internalStaticCallContext(ctx: ExtractContext): StaticCallContext | undefined {
  const value = ctx.unstableNative?.staticContext
  return isStaticCallContext(value) ? value : undefined
}

/**
 * Reads the minimal TypeScript node payload exposed for internal traversal helpers.
 *
 * This should only be used by compiler-owned helpers that project native syntax into immutable reader
 * values or extracted facts.
 */
export function internalTypeScriptContext(ctx: ExtractContext): InternalTypeScriptContext | undefined {
  const value = ctx.unstableNative?.typescript
  return isTypeScriptContext(value) ? value : undefined
}

/** Narrows an unknown value to the parser-native static call context shape. */
function isStaticCallContext(value: unknown): value is StaticCallContext {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'root' in value &&
    'file' in value &&
    'sourceFile' in value &&
    'callName' in value &&
    'variableName' in value &&
    'localInitializers' in value,
  )
}

/** Narrows an unknown value to the internal TypeScript node payload shape. */
function isTypeScriptContext(value: unknown): value is InternalTypeScriptContext {
  return Boolean(value && typeof value === 'object' && 'sourceFile' in value && 'call' in value)
}
