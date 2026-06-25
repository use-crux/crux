import type ts from 'typescript'
import type { StaticCallContext } from '../../../extractors/types'
import type {
  StaticInitializerRecord,
  StaticObjectValue,
  StaticSourceMatch,
  StaticSyntaxFileRecord,
} from '../../../static/syntax-record/types'
import type { StaticSyntaxInitializerMap } from '../../../static/syntax-record/value'
import type { ExtractContext } from '../../../extensions/public-contract/extractor-types'

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
 * Compiler-owned syntax-record payload carried for first-party record adapters.
 *
 * The payload contains normalized, JSON-safe syntax evidence instead of parser-native AST nodes. It is
 * still internal because first-party extractors may need richer migration helpers than the public
 * stable reader surface while the syntax pipeline is switching to records.
 */
export interface InternalStaticRecordContext {
  /** Project root used for deterministic local ids. */
  readonly root: string
  /** Syntax record that owns the current match. */
  readonly record: StaticSyntaxFileRecord
  /** Current record match being extracted. */
  readonly match: StaticSourceMatch
  /** Selected object/config argument for the running extractor, when present. */
  readonly objectArg?: StaticObjectValue
  /** Source-local initializer lookup for conservative alias resolution. */
  readonly initializers: StaticSyntaxInitializerMap
  /** Source-local initializer records visible at the current match. */
  readonly initializerRecords: readonly StaticInitializerRecord[]
  /** Already parsed syntax records keyed by absolute file path for direct import source refs. */
  readonly recordsByFile?: ReadonlyMap<string, StaticSyntaxFileRecord>
}

/**
 * Opaque compiler-created handle for parser-native extraction state.
 *
 * The handle gives first-party adapters access to compiler-created syntax payloads without making raw
 * parser objects structurally forgeable on `ExtractContext`. Extension authors should continue to use
 * the stable reader and builder APIs; only compiler-owned modules should create or unwrap this value.
 */
export interface NativeSyntaxHandle {
  readonly [nativeSyntaxHandleBrand]: true
  readonly staticContext?: StaticCallContext
  readonly typescript?: InternalTypeScriptContext
  readonly record?: InternalStaticRecordContext
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

/** Creates the native syntax handle attached to record-backed internal extractor contexts. */
export function createStaticRecordSyntaxHandle(input: InternalStaticRecordContext): NativeSyntaxHandle {
  return Object.freeze({
    [nativeSyntaxHandleBrand]: true as const,
    record: input,
  })
}

/**
 * Reads the parser-Static Index call context from the first-party internal payload.
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

/**
 * Reads the backend-neutral syntax-record context from the first-party internal payload.
 *
 * Record adapters must not assume a specific parser frontend; the returned values are normalized
 * syntax records that can be produced by TypeScript, Oxc, or future native frontends.
 */
export function internalStaticRecordContext(ctx: ExtractContext): InternalStaticRecordContext | undefined {
  return isNativeSyntaxHandle(ctx.internalNative) ? ctx.internalNative.record : undefined
}

/** Narrows an unknown value to the compiler-created native syntax handle. */
function isNativeSyntaxHandle(value: unknown): value is NativeSyntaxHandle {
  return Boolean(value && typeof value === 'object' && nativeSyntaxHandleBrand in value)
}
