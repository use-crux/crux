import type {
  IndexDiagnostic,
  SourceLocation,
  SourceSnippet,
} from '@use-crux/core/project-index'
import type { StaticSourceMatch, StaticSyntaxValue } from './value-types'

export type {
  StaticArrayValue,
  StaticCallSourceMatch,
  StaticCallValue,
  StaticFunctionCallValue,
  StaticFunctionParameterBinding,
  StaticFunctionValue,
  StaticIdentifierValue,
  StaticLiteralValue,
  StaticNewSourceMatch,
  StaticObjectProperty,
  StaticObjectSourceMatch,
  StaticObjectValue,
  StaticPropertyAccessValue,
  StaticSourceMatch,
  StaticSourceMatchBase,
  StaticSyntaxValue,
  StaticTemplateValue,
  StaticUnsupportedValue,
} from './value-types'

/**
 * Syntax frontend implementation name.
 *
 * This is intentionally smaller than a parser package name. The concrete parser can change within a
 * frontend family as long as the frontend identity version changes when normalized output can change.
 */
export type StaticSyntaxFrontendName = 'typescript' | 'oxc-rust'

/**
 * Structured identity for one syntax frontend implementation.
 *
 * Frontend identity participates in static cache identity once syntax records become the extraction
 * input. It is not a user-facing backend switch.
 */
export interface StaticSyntaxFrontendIdentity {
  /** Stable frontend family. */
  readonly name: StaticSyntaxFrontendName
  /** Parser or frontend version that can affect normalized records. */
  readonly version: string
}

/**
 * Backend-neutral syntax frontend used by the static Project Index pipeline.
 *
 * A frontend owns parser-specific memory and emits JSON-safe Crux syntax records. Callers must not
 * observe TypeScript, Oxc, or ESTree AST nodes through this interface.
 */
export interface StaticSyntaxFrontend {
  /** Frontend family. */
  readonly name: StaticSyntaxFrontendName
  /** Structured frontend identity for cache keys and diagnostics. */
  readonly identity: StaticSyntaxFrontendIdentity
  /** Parses one source file into a compact normalized syntax record. */
  parseFile(
    input: StaticSyntaxFileInput,
  ): Promise<StaticSyntaxFileRecord> | StaticSyntaxFileRecord
  /**
   * Parses many source files in one frontend-owned batch.
   *
   * Native frontends can use this to keep parser state in one process and schedule work on their
   * own thread pool. Output order must match input order.
   */
  parseFiles?(
    inputs: readonly StaticSyntaxFileInput[],
  ):
    | Promise<readonly StaticSyntaxFileRecord[]>
    | readonly StaticSyntaxFileRecord[]
}

/**
 * Creates a syntax frontend after the compiler runtime has selected extractor call names.
 *
 * Prefer factories for non-default frontends so the extraction engine can inject the same manifest
 * filters used by the TypeScript compatibility frontend. Passing a prebuilt frontend is still useful
 * for tests that need an exact parser identity, but the caller then owns its filter configuration.
 */
export interface StaticSyntaxFrontendFactory {
  (options: StaticSyntaxFrontendOptions): StaticSyntaxFrontend
}

/** Source text input for one syntax frontend parse. */
export interface StaticSyntaxFileInput {
  /** Absolute project root used for relative fallback ids. */
  readonly root: string
  /** Absolute source file path. */
  readonly file: string
  /** Source text to parse. */
  readonly source: string
}

/** Match prefilter options supplied by the compiler runtime. */
export interface StaticSyntaxFrontendOptions {
  /** Factory or imported call names worth recording for static extraction. Empty records all calls. */
  readonly callNames?: readonly string[]
  /**
   * Import-aware call interests worth recording for static extraction.
   *
   * When present, these are more precise than `callNames`: broad interests keep
   * same-name local calls, while `importFrom` interests only retain callees
   * imported from matching module specifiers. `callNames` remains as a legacy
   * compatibility prefilter for callers that have not adopted structured
   * interests yet.
   */
  readonly callInterests?: readonly StaticSyntaxCallInterest[]
  /** Constructor names worth recording as static definitions. Defaults to first-party `Agent`. */
  readonly constructorNames?: readonly string[]
  /**
   * Import-aware constructor interests worth recording for static extraction.
   *
   * Broad interests match visible constructor names. `importFrom` interests
   * only match constructors resolved through an import binding.
   */
  readonly constructorInterests?: readonly StaticSyntaxConstructorInterest[]
  /**
   * Native fact call names whose original match evidence can be pruned after packet projection.
   *
   * The compiler derives this from extension manifests. Frontends must only apply it when a native
   * packet for the match replaces every bundled extractor that needs the dropped arguments/config.
   */
  readonly pruneNativeFactCallNames?: readonly string[]
}

/** Import-aware call interest consumed by syntax frontends. */
export interface StaticSyntaxCallInterest {
  /** Factory/callee name after import-alias normalization. */
  readonly name: string
  /** Optional module specifiers that must provide this callee. */
  readonly importFrom?: readonly string[]
  /** Object/config argument index for positional APIs. */
  readonly configArg?: number
  /** Config properties the extension expects to inspect. */
  readonly properties?: readonly string[]
  /** Callback config properties the extension expects to summarize. */
  readonly callbacks?: readonly StaticSyntaxCallbackInterest[]
  /** Origin of this normalized interest. Manifest interests are eligible for evidence slicing. */
  readonly source?: 'manifest' | 'extractor-pattern'
}

/** Import-aware constructor interest consumed by syntax frontends. */
export interface StaticSyntaxConstructorInterest {
  /** Constructor/class name after import-alias normalization. */
  readonly name: string
  /** Optional module specifiers that must provide this constructor. */
  readonly importFrom?: readonly string[]
  /** Object/config argument index for positional APIs. */
  readonly configArg?: number
  /** Config properties the extension expects to inspect. */
  readonly properties?: readonly string[]
  /** Callback config properties the extension expects to summarize. */
  readonly callbacks?: readonly StaticSyntaxCallbackInterest[]
  /** Origin of this normalized interest. Manifest interests are eligible for evidence slicing. */
  readonly source?: 'manifest' | 'extractor-pattern'
}

/** Callback property retained by sliced syntax evidence. */
export interface StaticSyntaxCallbackInterest {
  /** Config property that contains or references the callback. */
  readonly property: string
  /** Conservative helper-call traversal depth for callback summaries. */
  readonly maxDepth?: number
}

/**
 * Normalized syntax evidence for one source file.
 *
 * This is the Phase 10 logical ABI. It is JSON-safe today and can later be encoded as a binary
 * transport without changing extractor semantics.
 */
export interface StaticSyntaxFileRecord {
  /** Record schema version. */
  readonly schemaVersion: 1
  /** Frontend that produced the record. */
  readonly frontend: StaticSyntaxFrontendIdentity
  /** Absolute source file path. */
  readonly file: string
  /** Project-root-relative source path with portable `/` separators. */
  readonly relativePath: string
  /** SHA-256 hash of the exact parsed source text. */
  readonly sourceHash: string
  /** SHA-256 hash of the exported surface used to firewall dependent invalidation. */
  readonly interfaceHash?: string
  /** Static import bindings visible in this file. */
  readonly imports: readonly StaticImportRecord[]
  /** Source-local declarations and call sites that may produce Project Index facts. */
  readonly matches: readonly StaticSourceMatch[]
  /**
   * Optional compiler-owned static facts projected by the syntax frontend for specific matches.
   *
   * Native frontends should populate this only for first-party shapes whose output is byte-for-byte
   * compatible with the TypeScript extractor path. The TypeScript compiler runtime consumes these
   * packets before dispatching extension extractors for the same match, and falls back to extractors
   * whenever a match has no native projection.
   */
  readonly nativeFacts?: readonly StaticNativeFactProjection[]
  /** Top-level local initializer values available to record-backed readers. */
  readonly localInitializers: readonly StaticInitializerRecord[]
  /** Parser diagnostics normalized into the Project Index diagnostic shape. */
  readonly diagnostics: readonly IndexDiagnostic[]
}

/**
 * Fact packet emitted by a native frontend for one syntax-record match.
 *
 * `facts` intentionally uses `unknown` at the syntax-record ABI layer. The compiler owns the native
 * frontend and validates the packet by routing it through the same internal `ExtractedFacts`
 * normalizers used by TypeScript extractors.
 */
export interface StaticNativeFactProjection {
  /** Zero-based index into `StaticSyntaxFileRecord.matches`. */
  readonly matchIndex: number
  /**
   * Bundled extractor identities replaced by this native packet.
   *
   * Native facts are an optimization for compiler-owned extractors, not a reason to hide the source
   * match from user extensions. When present, the record runtime skips only these extractor identities
   * and still dispatches other matching TypeScript extensions for the same syntax match.
   */
  readonly replaces?: readonly StaticNativeFactExtractorIdentity[]
  /** JSON-safe compiler fact packet matching the internal `ExtractedFacts` shape. */
  readonly facts: unknown
}

/** Extractor identity replaced by a native first-party fact packet. */
export interface StaticNativeFactExtractorIdentity {
  /** Extension package name that owns the replaced extractor. */
  readonly extension: string
  /** Extractor name within the owning extension. */
  readonly extractor: string
}

/** Import binding visible under a local source name. */
export interface StaticImportRecord {
  /** Local identifier authored in this file. */
  readonly localName: string
  /** Imported name before local aliasing. */
  readonly importedName: string
  /** Authored module specifier. */
  readonly moduleSpecifier: string
  /** Whether the binding is available at runtime or only in the TypeScript type space. */
  readonly importKind?: 'value' | 'type'
  /** Resolved local project file when the static resolver can prove one. */
  readonly resolvedFile?: string
  /** Source location of the import declaration. */
  readonly source: SourceLocation
}

/** Top-level initializer available for conservative local alias resolution. */
export interface StaticInitializerRecord {
  /** Local variable name. */
  readonly name: string
  /** JSON-safe normalized initializer value. */
  readonly value: StaticSyntaxValue
  /** Source location of the initializer expression. */
  readonly source: SourceLocation
  /** Source snippet for the initializer expression. */
  readonly snippet?: SourceSnippet
}

/** Callee or constructor identity after import alias normalization. */
export interface StaticCalleeRecord {
  /** Match name used by extractor dispatch. Imported names take precedence over local aliases. */
  readonly name: string
  /** Whether the callee was authored as a direct identifier rather than a member expression. */
  readonly direct?: boolean
  /** Local callable identifier when one exists. */
  readonly localName?: string
  /** Imported callable name before local aliasing. */
  readonly importedName?: string
  /** Authored module specifier when the callable came from an import. */
  readonly moduleSpecifier?: string
  /** Resolved local project file when the callable import can be resolved. */
  readonly resolvedFile?: string
}
