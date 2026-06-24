import type { SourceLocation, SourceSnippet } from '@crux/core/project-index'
import type { StaticObjectReader } from '../public-contract/authoring-types'
import type {
  StaticCalleeRecord,
  StaticFunctionCallValue,
  StaticSyntaxValue,
} from '../../static/syntax-record'

export type StaticEvidenceInterestSource = 'manifest' | 'extractor-pattern'

/**
 * How much syntax evidence an extension expects from the compiler.
 *
 * `declared` is the fast path: the extension promises that its static readers can be satisfied by
 * the serializable interests below. `compatibility` keeps the legacy broad syntax-record fallback for
 * extensions that may call open-ended readers such as full config JSON.
 */
export type StaticEvidenceMode = 'declared' | 'compatibility'

/** Compatibility policy for one extension's static evidence needs. */
export interface StaticEvidenceCompatibility {
  /** Evidence mode selected by the extension manifest. Defaults to `compatibility` for safety. */
  readonly mode: StaticEvidenceMode
  /** Optional diagnostic/debug reason surfaced in compiler manifests and benchmarks. */
  readonly reason?: string
}

/** Declarative callback evidence requested by an extension. */
export interface StaticCallbackInterest {
  /** Config property that contains or references the callback. */
  readonly property: string
  /** Conservative helper-call traversal depth for callback summaries. */
  readonly maxDepth?: number
}

/** Declarative call evidence requested by an extension or derived from extractor patterns. */
export interface StaticCallInterest {
  /** Factory/callee name after import-alias normalization. */
  readonly name: string
  /** Optional module specifier constraints. */
  readonly importFrom?: readonly string[]
  /** Object/config argument index for positional APIs. */
  readonly configArg?: number
  /** Config properties the extension expects to inspect. */
  readonly properties?: readonly string[]
  /** Callback properties the extension expects to summarize. */
  readonly callbacks?: readonly StaticCallbackInterest[]
  /** Origin of this normalized interest. */
  readonly source?: StaticEvidenceInterestSource
}

/** Declarative constructor evidence requested by an extension or derived from extractor patterns. */
export interface StaticConstructorInterest {
  /** Constructor/class name after import-alias normalization. */
  readonly name: string
  /** Optional module specifier constraints. */
  readonly importFrom?: readonly string[]
  /** Object/config argument index for positional APIs. */
  readonly configArg?: number
  /** Origin of this normalized interest. */
  readonly source?: StaticEvidenceInterestSource
}

/**
 * AST-free source evidence interests declared by TypeScript indexer extensions.
 *
 * The compiler uses this manifest to decide which bounded evidence Rust/TypeScript syntax frontends
 * should retain. It is intentionally data-only so Go, Rust, and Node can all reason about it without
 * loading extension code.
 */
export interface StaticEvidenceInterestManifest {
  readonly calls?: readonly StaticCallInterest[]
  readonly constructors?: readonly StaticConstructorInterest[]
  readonly definitions?: readonly string[]
  readonly relations?: readonly string[]
  readonly compatibility?: StaticEvidenceCompatibility
}

export type StaticEvidenceKind = 'call' | 'new' | 'object'

/** JSON-safe evidence item for one syntax-record match. */
export interface StaticMatchEvidence {
  readonly id: string
  readonly kind: StaticEvidenceKind
  readonly file: string
  readonly variableName: string
  readonly localName: string
  readonly exported: boolean
  readonly callee?: StaticCalleeRecord
  readonly args?: readonly StaticSyntaxValue[]
  readonly source: SourceLocation
  readonly snippet?: SourceSnippet
}

export interface StaticCallEvidenceQuery {
  readonly name?: string
  readonly importFrom?: readonly string[]
}

export interface StaticConstructorEvidenceQuery {
  readonly name?: string
  readonly importFrom?: readonly string[]
}

export interface StaticCallbackSummaryInput {
  readonly evidenceId: string
  readonly property: string
  readonly maxDepth?: number
}

/** Bounded callback summary retained without exposing parser AST nodes. */
export interface StaticCallbackSummary {
  readonly property: string
  readonly calls: readonly StaticFunctionCallValue[]
  readonly returns: readonly StaticSyntaxValue[]
  readonly source: SourceLocation
  readonly snippet?: SourceSnippet
}

/** Record-backed evidence reader exposed to TS extension runtimes. */
export interface StaticEvidenceReader {
  calls(query?: StaticCallEvidenceQuery): readonly StaticMatchEvidence[]
  constructors(query?: StaticConstructorEvidenceQuery): readonly StaticMatchEvidence[]
  config(evidenceId: string): StaticObjectReader | undefined
  callbackSummary(input: StaticCallbackSummaryInput): StaticCallbackSummary | undefined
}
