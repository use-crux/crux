import type ts from 'typescript'
import type { StaticCallContext } from '../extractors/types'
import type { ExtractContext } from './extractor-types'

const nativeSyntaxHandleBrand: unique symbol = Symbol('crux.indexer.nativeSyntaxHandle')

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
 * Opaque compiler-created handle for parser-native extraction state.
 *
 * The handle gives first-party adapters a temporary bridge back to TypeScript nodes without making raw
 * AST payloads structurally forgeable on `ExtractContext`. Extension authors should continue to use
 * the stable reader and builder APIs; only compiler-owned modules should create or unwrap this value.
 */
export interface NativeSyntaxHandle {
  readonly [nativeSyntaxHandleBrand]: true
  readonly staticContext: StaticCallContext
  readonly typescript: InternalTypeScriptContext
}

/**
 * Creates the native syntax handle attached to internal extractor contexts.
 *
 * Keeping construction in this module gives the compiler a single point to change or delete once the
 * remaining first-party extractors no longer need TypeScript node access.
 */
export function createNativeSyntaxHandle(input: {
  readonly staticContext: StaticCallContext
  readonly typescript: InternalTypeScriptContext
}): NativeSyntaxHandle {
  return Object.freeze({
    [nativeSyntaxHandleBrand]: true as const,
    staticContext: input.staticContext,
    typescript: input.typescript,
  })
}

/**
 * Reads the parser-native static call context from the first-party internal payload.
 *
 * Centralizing this access keeps native parser payloads out of individual extractors/helpers and makes the
 * remaining TypeScript-native islands easy to audit.
 */
export function internalStaticCallContext(ctx: ExtractContext): StaticCallContext | undefined {
  return isNativeSyntaxHandle(ctx.internalNative) ? ctx.internalNative.staticContext : undefined
}

/**
 * Reads the minimal TypeScript node payload exposed for internal traversal helpers.
 *
 * This should only be used by compiler-owned helpers that project native syntax into immutable reader
 * values or extracted facts.
 */
export function internalTypeScriptContext(ctx: ExtractContext): InternalTypeScriptContext | undefined {
  return isNativeSyntaxHandle(ctx.internalNative) ? ctx.internalNative.typescript : undefined
}

/** Narrows an unknown value to the compiler-created native syntax handle. */
function isNativeSyntaxHandle(value: unknown): value is NativeSyntaxHandle {
  return Boolean(value && typeof value === 'object' && nativeSyntaxHandleBrand in value)
}
