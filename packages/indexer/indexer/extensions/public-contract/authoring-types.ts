import type { JsonSchema, ProjectDefinitionKind, ProjectSourceRefRole } from '@use-crux/core/project-index'
import type { ExtractedDefinition, ExtractedSourceRef, UnresolvedReference } from './types'
export interface StaticObjectReader {
  /** Returns whether a property exists in the object, including shorthand properties. */
  has(property: string): boolean
  /** Reads a string literal property or returns `undefined` for non-literal values. */
  string(property: string): string | undefined
  /** Reads a numeric literal property or returns `undefined` for non-literal values. */
  number(property: string): number | undefined
  /** Reads a boolean literal property or returns `undefined` for non-literal values. */
  boolean(property: string): boolean | undefined
  /** Reads a string-literal array property; unsupported or missing arrays return an empty array. */
  stringArray(property: string): readonly string[]
  /** Reads an identifier-valued property, preserving the authored binding name. */
  identifier(property: string): string | undefined
  /**
   * Reads a reference-like property, including shorthand properties, property-access expressions, and
   * helper/factory call names.
   *
   * Use this for config values that point at another authored binding or runtime component, for
   * example `{ store }`, `{ component: components.crux }`, or `{ source: helper(...) }`. The reader
   * returns the authored binding name, final property segment, or helper name and returns `undefined`
   * for dynamic expressions.
   */
  reference(property: string): string | undefined
  /**
   * Reads the callee name when a property is authored directly as a helper/factory call.
   *
   * Unlike `reference`, this does not classify identifier-backed properties as calls, so extractors can
   * distinguish `{ source: loader }` from `{ source: loader() }` when that distinction affects metadata.
   */
  callName(property: string): string | undefined
  /** Reads an array of identifier references, preserving authored binding names. */
  identifierArray(property: string): readonly string[]
  /** Reads a nested object literal property as another stable object reader. */
  object(property: string): StaticObjectReader | undefined
  /** Reads an array of object literals as stable object readers. */
  objectArray(property: string): readonly StaticObjectReader[]
  /** Reads a factory call whose first argument is an object literal. */
  callObject(property: string): StaticCallObjectReader | undefined
  /** Reads an array of factory calls whose first argument is an object literal. */
  callObjectArray(property: string): readonly StaticCallObjectReader[]
  /** Reads a string literal through a nested object path such as `['write', 'mode']`. */
  nestedString(path: readonly string[]): string | undefined
  /** Reads object-map values that are identifier references, useful for tool maps and agent maps. */
  objectMapIdentifiers(property: string): readonly string[]
  /**
   * Reads object-map entries whose values are identifier references.
   *
   * Use this when both the authored key and the referenced binding matter, for example
   * `{ writer: writerAgent }` where `writer` is a display/order label and `writerAgent` is the
   * relation target.
   */
  objectMapIdentifierEntries(property: string): readonly StaticObjectMapIdentifierEntry[]
  /** Projects a property into JSON Schema when the static analyzer can do so safely. */
  schema(property: string): JsonSchema | undefined
  /**
   * Projects a property, or the whole object when omitted, into JSON-compatible data.
   *
   * Values that cannot be represented safely are omitted or returned as `undefined`.
   */
  json(property?: string): unknown
}

/** Authored object-map entry whose value is a source-local identifier reference. */
export interface StaticObjectMapIdentifierEntry {
  /** Authored object-map key. */
  readonly key: string
  /** Identifier binding referenced by the entry value. */
  readonly value: string
}

/**
 * Stable argument reader exposed to static extractors.
 *
 * Argument readers follow the same conservative model as config readers. They are best suited for
 * factory APIs such as `suite('name', ...)` or `defineThing('id', { ... })`, where source-local literal
 * values are enough to emit index facts.
 */
export interface StaticArgumentReader {
  /** Reads a string literal argument at `index`. */
  string(index: number): string | undefined
  /** Reads an identifier argument at `index`, preserving the authored binding name. */
  identifier(index: number): string | undefined
  /** Reads an object literal argument at `index` as a stable object reader. */
  object(index: number): StaticObjectReader | undefined
  /** Reads an array of object literals at `index` as stable object readers. */
  objectArray(index: number): readonly StaticObjectReader[]
  /** Projects an argument into JSON-compatible data when the value can be represented safely. */
  json(index: number): unknown
}

/**
 * Stable reader for a factory call with an object-literal config argument.
 *
 * This supports first-party APIs that accept arrays such as `blocks: [workingState({ ... })]`
 * without exposing TypeScript call nodes to extractors.
 */
export interface StaticCallObjectReader {
  /** Factory/callee name, for example `workingState` or `recentMessages`. */
  readonly name: string | undefined
  /** Reader for the call's first object/config argument. */
  readonly config: StaticObjectReader
}

/**
 * Author-facing alias for the positional argument reader.
 *
 * The older `StaticArgumentReader` name remains for internal compatibility during migration, but new
 * extractor code should prefer `ArgumentReader` because the public API is organized around compiler
 * roles rather than implementation modes.
 */
export type ArgumentReader = StaticArgumentReader

/**
 * Author-facing alias for the object/config reader.
 *
 * The older `StaticObjectReader` name remains for internal compatibility during migration, but new
 * extractor code should prefer `ConfigReader` to avoid exposing static-parser vocabulary at the API
 * boundary.
 */
export type ConfigReader = StaticObjectReader

/**
 * Author-facing alias for factory calls that carry object configs.
 *
 * Prefer this over native call nodes when an extractor needs to inspect arrays of configured helper
 * calls such as memory blocks or pipeline stages.
 */
export type ConfigCallReader = StaticCallObjectReader

/**
 * Builder for source references that point from index definitions back into authored code.
 *
 * Source refs are emitted as facts instead of attached through mutation. This keeps extraction
 * source-local and lets the compiler decide how refs are merged with primary definition locations.
 */
export interface SourceRefBuilder {
  /**
   * Returns a source ref for a named object/config property.
   *
   * Use this for simple literal or identifier-backed properties such as `{ system: SYSTEM_PROMPT }`.
   * Returns `undefined` when there is no config object or the property cannot be located safely.
   */
  property(input: {
    readonly property: string
    readonly role: ProjectSourceRefRole
    readonly definitionId: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }): ExtractedSourceRef | undefined
  /**
   * Returns a source ref for a callback/function-valued config property.
   *
   * Use this for handler-style properties such as `execute`, `resolve`, `usageHandler`, or `check`.
   * Returns `undefined` when the callback is absent or cannot be represented safely.
   */
  callbackProperty(input: {
    readonly property: string
    readonly role: ProjectSourceRefRole
    readonly definitionId: string
    readonly metadata?: Readonly<Record<string, unknown>>
  }): ExtractedSourceRef | undefined
  /**
   * Returns source refs for expressions interpolated into a template-literal property.
   *
   * This lets detail views point from a static prompt/context definition back to supporting constants
   * used inside template strings.
   */
  templateInterpolations(input: {
    readonly property: string
    readonly role: ProjectSourceRefRole
    readonly definitionId: string
  }): readonly ExtractedSourceRef[]
  /**
   * Projects a schema property and returns both the schema and source refs for schema declarations.
   *
   * Use the returned `schema` for definition metadata and spread `sourceRefs` into extracted facts so
   * consumers can navigate to nested or helper schema definitions.
   */
  schemaProperty(input: { readonly property: string; readonly definitionId: string }): {
    readonly schema?: JsonSchema
    readonly sourceRefs: readonly ExtractedSourceRef[]
  }
  /**
   * Returns source refs for helper functions referenced by a config property.
   *
   * `maxDepth` limits conservative traversal through helper bodies. The helper is intended for
   * first-party static intelligence such as visible data access, not arbitrary public AST traversal.
   */
  helperRefsForProperty(input: {
    readonly property: string
    readonly definitionId: string
    readonly maxDepth?: number
  }): readonly ExtractedSourceRef[]
}

/**
 * Builder for index definitions that applies compiler-owned source, id, and metadata defaults.
 *
 * Extractors should prefer this builder over constructing `ProjectDefinition` objects manually unless
 * they are reusing an existing compiler-owned definition. The builder keeps definition construction
 * pure while centralizing details such as source snippets and fidelity/status defaults.
 */
export interface DefinitionBuilder {
  /**
   * Builds a index definition contribution using compiler-owned source defaults.
   *
   * The returned value is an `ExtractedDefinition`, ready to place in `facts({ definitions: [...] })`.
   */
  definition(input: DefinitionBuilderInput): ExtractedDefinition
  /**
   * Wraps an already-built compiler-owned definition contribution.
   *
   * Use this when another compiler helper has already constructed a `ProjectDefinition` with the
   * correct source and metadata defaults.
   */
  fromProjectDefinition(input: ExtractedDefinition): ExtractedDefinition
}

/**
 * Input accepted by `DefinitionBuilder.definition`.
 *
 * The builder receives index identity and metadata only; source ranges, snippets, default fidelity,
 * and status are supplied by the compiler context. This division keeps extractor output deterministic
 * and avoids repeated source-normalization code in each first-party extractor.
 */
export interface DefinitionBuilderInput {
  /** Source binding associated with the definition contribution. */
  readonly variableName: string
  /** Stable index definition id. */
  readonly id: string
  /** Stable index definition kind from `@use-crux/core/project-index`. */
  readonly kind: ProjectDefinitionKind
  /** Display name for index consumers. */
  readonly name: string
  /** JSON-like metadata to attach to the index definition. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/**
 * Builder for unresolved relation references.
 *
 * Use `variable(...)` when the target should be resolved against imports or local bindings. Use
 * `id(...)` only when the extractor already knows a stable index definition id.
 */
export interface ReferenceBuilder {
  /**
   * Creates a reference to an authored variable/import binding.
   *
   * The resolver binds this later, after file-local and imported definitions are known.
   */
  variable(type: string, toVariable: string): UnresolvedReference
  /**
   * Creates a reference to a known index definition id.
   *
   * Prefer `variable(...)` when the target came from source code as an identifier; use `id(...)` when
   * the extractor has intentionally constructed or read a stable index id.
   */
  id(type: string, toId: string): UnresolvedReference
}
