import type { SourceLocation, SourceSnippet } from '@use-crux/core/project-index'
import type { StaticCalleeRecord, StaticInitializerRecord } from './types'

/** Source match emitted for a Project Index extractor candidate. */
export type StaticSourceMatch = StaticCallSourceMatch | StaticNewSourceMatch | StaticObjectSourceMatch

/** Fields shared by source matches. */
export interface StaticSourceMatchBase {
  /** Authored binding name or deterministic fallback for call-site matches. */
  readonly variableName: string
  /** Project-relative deterministic fallback name. */
  readonly localName: string
  /** Whether the declaration was exported from this source file. */
  readonly exported: boolean
  /** Source location of the matched expression. */
  readonly source: SourceLocation
  /** Source snippet for the matched expression. */
  readonly snippet?: SourceSnippet
  /** Additional local initializers visible at this match, such as constants inside a factory function. */
  readonly localInitializers?: readonly StaticInitializerRecord[]
}

/** Factory call match such as `prompt({ ... })`. */
export interface StaticCallSourceMatch extends StaticSourceMatchBase {
  readonly kind: 'call'
  readonly callee: StaticCalleeRecord
  readonly args: readonly StaticSyntaxValue[]
  readonly objectArg?: StaticObjectValue
}

/** Constructor match such as `new Agent({ ... })`. */
export interface StaticNewSourceMatch extends StaticSourceMatchBase {
  readonly kind: 'new'
  readonly callee: StaticCalleeRecord
  readonly args: readonly StaticSyntaxValue[]
  readonly objectArg?: StaticObjectValue
}

/** Object literal match, usually for first-party compatibility object schemas. */
export interface StaticObjectSourceMatch extends StaticSourceMatchBase {
  readonly kind: 'object'
  readonly object: StaticObjectValue
}

/** JSON-safe expression value understood by record-backed extractor readers. */
export type StaticSyntaxValue =
  | StaticLiteralValue
  | StaticIdentifierValue
  | StaticPropertyAccessValue
  | StaticObjectValue
  | StaticArrayValue
  | StaticCallValue
  | StaticTemplateValue
  | StaticFunctionValue
  | StaticUnsupportedValue

/** Literal values that can be represented without evaluation. */
export interface StaticLiteralValue {
  readonly kind: 'literal'
  readonly value: string | number | boolean | null
}

/** Identifier reference value. */
export interface StaticIdentifierValue {
  readonly kind: 'identifier'
  readonly name: string
}

/** Property access reference value such as `components.crux`. */
export interface StaticPropertyAccessValue {
  readonly kind: 'property-access'
  readonly name: string
  readonly path: readonly string[]
}

/** Object literal value. */
export interface StaticObjectValue {
  readonly kind: 'object'
  readonly properties: readonly StaticObjectProperty[]
  readonly source: SourceLocation
  readonly snippet?: SourceSnippet
}

/** Object property projected into a stable name/value pair. */
export interface StaticObjectProperty {
  readonly name: string
  readonly value: StaticSyntaxValue
  readonly shorthand: boolean
  /** Whether this property represents an object spread such as `{ ...tools }`. */
  readonly spread?: boolean
  readonly source: SourceLocation
}

/** Array literal value. */
export interface StaticArrayValue {
  readonly kind: 'array'
  readonly elements: readonly StaticSyntaxValue[]
}

/** Nested call expression value. */
export interface StaticCallValue {
  readonly kind: 'call'
  readonly callee: StaticCalleeRecord
  /** Receiver expression for method calls such as `z.string().describe(...)`. */
  readonly receiver?: StaticSyntaxValue
  readonly args: readonly StaticSyntaxValue[]
  readonly source: SourceLocation
  readonly snippet?: SourceSnippet
}

/** Template literal value with conservative expression placeholders. */
export interface StaticTemplateValue {
  readonly kind: 'template'
  readonly text: string
  readonly expressions: readonly StaticSyntaxValue[]
}

/** Function-like value retained as source evidence without executable details. */
export interface StaticFunctionValue {
  readonly kind: 'function'
  /** Parameter names visible on this function, in declaration order. */
  readonly parameterNames?: readonly string[]
  /** Bindings introduced by the first parameter, preserving object-pattern source property names. */
  readonly firstParameterBindings?: readonly StaticFunctionParameterBinding[]
  /** Ordered call expressions visible inside the function body. */
  readonly calls: readonly StaticFunctionCallValue[]
  /**
   * Return values visible inside the function body.
   *
   * Native frontends resolve direct identifier returns at record-production time using their binding graph.
   * Consumers must not reinterpret `localInitializers` as a lazy scope database for return-site resolution.
   */
  readonly returns: readonly StaticSyntaxValue[]
  /** Function-scoped initializer evidence retained for display and compatibility, not lazy binding resolution. */
  readonly localInitializers: readonly StaticInitializerRecord[]
  readonly source: SourceLocation
  readonly snippet?: SourceSnippet
}

/** One binding introduced by a function parameter pattern. */
export interface StaticFunctionParameterBinding {
  /** Local identifier name visible inside the function body. */
  readonly name: string
  /** Source object property name when this binding came from object destructuring. */
  readonly propertyName?: string
}

/** Function-body call evidence normalized without exposing parser AST nodes. */
export interface StaticFunctionCallValue {
  /** Callee or method identity. */
  readonly callee: StaticCalleeRecord
  /** Receiver expression for method calls such as `flow.step(...)`. */
  readonly receiver?: StaticSyntaxValue
  /** Normalized arguments supplied to the call. */
  readonly args: readonly StaticSyntaxValue[]
  /** Source location of the call expression. */
  readonly source: SourceLocation
  /** Source snippet for the call expression. */
  readonly snippet?: SourceSnippet
}

/** Expression shape the syntax record cannot safely model yet. */
export interface StaticUnsupportedValue {
  readonly kind: 'unsupported'
  readonly syntaxKind: string
  readonly source: SourceLocation
}
