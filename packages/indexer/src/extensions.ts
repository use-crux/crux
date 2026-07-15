/**
 * Experimental Crux Indexer extension boundary.
 *
 * This surface is intentionally small: extension authors describe facts they can prove from a
 * parser-owned source match, and the Project Index Compiler owns traversal, ordering, validation,
 * relation resolution, cache identity, and output projection.
 *
 * Third-party packages are loaded only through an explicit trust policy. Resolution preflights the
 * configured package name before `import(...)`, checks installed package metadata, and then passes
 * the manifest through the same deterministic extension runtime used by first-party extractors.
 *
 * Treat this subpath as experimental until the third-party loading, trust, versioning, and fixture
 * package contract is finalized.
 *
 * @module
 */
export {
  callPattern,
  facts,
  INDEXER_EXTENSION_API_VERSION,
  isIndexerExtensionAllowed,
  newPattern,
  none,
  PROJECT_INDEX_SCHEMA_VERSION,
  projectDefinition,
} from './indexer/extensions'
import type { IndexDiagnostic } from '@use-crux/core/project-index'
import type {
  IndexExtractor as InternalIndexExtractor,
  DefinitionBuilder,
  ExtensionIdentity,
  ExtractMatch,
  IndexerExtension as InternalIndexerExtension,
  ReferenceBuilder,
  SourceRefBuilder,
  SourceView,
  ArgumentReader,
  ConfigCallReader,
  ConfigReader,
  ConfiguredObjectReader,
  ExtensionReference,
  IndexerExtensionConfig,
} from './indexer/extensions'
import {
  loadIndexerExtensionReferences as loadInternalIndexerExtensionReferences,
  resolveIndexerExtensionReferences as resolveInternalIndexerExtensionReferences,
  validateIndexerExtensionManifest as validateInternalIndexerExtensionManifest,
} from './indexer/extensions'

export type {
  ArgumentReader,
  ConfigCallReader,
  ConfigReader,
  ConfiguredObjectReader,
  DefinitionBuilder,
  DefinitionBuilderInput,
  ExtensionIdentity,
  ExtensionReference,
  ExtensionTrustMode,
  ExtensionTrustPolicy,
  ExtractMatch,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  ExtractedSourceRef,
  IndexDependency,
  IndexerCompatibility,
  IndexerExtensionConfig,
  RelationSpec,
  ReferenceBuilder,
  SourceView,
  SourceReference,
  SourceRefBuilder,
  UnresolvedReference,
} from './indexer/extensions'

/**
 * Stable extractor context exposed by the experimental public authoring barrel.
 *
 * Extractors receive one context per parser match. The context exposes conservative readers and
 * builders rather than raw TypeScript nodes so extractor code can stay deterministic, cacheable, and
 * portable across future parser implementations.
 *
 * Read from `args`, `config`, and `source`; build returned facts with `define`, `ref`, and
 * `sourceRef`. Do not mutate compiler state, retain the context after `extract(...)` returns, or
 * depend on file-system/global process state.
 */
export interface ExtractContext {
  /** Identity of the extension that owns the running extractor. */
  readonly extension: ExtensionIdentity
  /** Name of the running extractor inside its extension. */
  readonly extractor: string
  /** Parser match that caused this extractor invocation. */
  readonly match: ExtractMatch
  /** Stable source-local identity and file information for the matched source. */
  readonly source: SourceView
  /** Conservative reader for positional call or constructor arguments. */
  readonly args: ArgumentReader
  /** Conservative reader for the selected object/config argument, when one is statically visible. */
  readonly config: ConfigReader | undefined
  /** Definition builder bound to compiler-owned source and metadata defaults. */
  readonly define: DefinitionBuilder
  /** Builder for unresolved relation references. */
  readonly ref: ReferenceBuilder
  /** Builder for supplemental source references. */
  readonly sourceRef: SourceRefBuilder
}

/**
 * Source-local fact extractor exposed to extension authors.
 *
 * An extractor is a pure source-to-facts function. It may return:
 *
 * - `facts(...)` when it can prove definitions, references, source refs, or diagnostics
 * - `none()` when the parser match is valid but not meaningful for this extractor
 * - a degraded result when it can emit partial facts and explain the missing evidence
 *
 * Cross-file linking, linting, cache invalidation, and snapshot emission belong to later compiler
 * phases, not extractor code.
 */
export interface IndexExtractor extends Omit<InternalIndexExtractor, 'extract'> {
  /** Converts one parser-owned source match into immutable compiler facts. */
  extract(ctx: ExtractContext): ReturnType<InternalIndexExtractor['extract']>
}

/**
 * Experimental public extension manifest.
 *
 * Manifests are data, not registration side effects. Importing a manifest should not mutate global
 * compiler state, start workers, read project files, or patch runtime behavior.
 *
 * V1 public authoring is intentionally limited to extractors and relation declarations. Compiler
 * profiles, parser construction, custom source discovery, raw AST traversal, rules, resolvers,
 * emitters, query scheduling, and side-effect loading remain internal until a separate public RFC
 * graduates them.
 */
export interface IndexerExtension
  extends Pick<InternalIndexerExtension, 'name' | 'version' | 'crux' | 'relations'> {
  /** Extractors contributed by this extension. */
  readonly extractors?: readonly IndexExtractor[]
}

/** Extension manifest obtained by trusted loader code before public validation. */
export interface InstalledIndexerExtension {
  /** Configured package specifier. */
  readonly package: string
  /** Selected package export. Defaults to `default`. */
  readonly export?: string
  /** Installed package version, when package metadata supplied it. */
  readonly packageVersion?: string
  /** Declarative public extension manifest. */
  readonly extension: IndexerExtension
}

/** Validated extension selected by one configured package reference. */
export interface ResolvedIndexerExtension {
  /** Normalized configuration reference. */
  readonly reference: ExtensionReference
  /** Installed package version, when available. */
  readonly packageVersion?: string
  /** Validated declarative public extension manifest. */
  readonly extension: IndexerExtension
}

/** Input for pure extension-reference resolution. */
export interface ResolveIndexerExtensionReferencesInput {
  readonly config?: IndexerExtensionConfig
  readonly installed?: readonly InstalledIndexerExtension[]
}

/** Result of public extension-reference resolution. */
export interface ResolveIndexerExtensionReferencesResult {
  readonly extensions: readonly ResolvedIndexerExtension[]
  readonly diagnostics: readonly IndexDiagnostic[]
}

/** Input for trusted package loading relative to a project root. */
export interface LoadIndexerExtensionReferencesInput {
  readonly root: string
  readonly config?: IndexerExtensionConfig
}

/** Result of validating one public extension manifest. */
export interface IndexerExtensionManifestValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
}

const RESERVED_EXTENSION_SLOTS = ['static', 'resolvers', 'rules', 'emitters', 'queries'] as const

/**
 * Validates the experimental public manifest shape.
 *
 * Reserved compiler slots are rejected even when JavaScript callers bypass the TypeScript surface.
 */
export function validateIndexerExtensionManifest(
  extension: IndexerExtension,
): IndexerExtensionManifestValidation {
  const reserved = reservedExtensionSlots(extension)
  if (reserved.length > 0) {
    return {
      valid: false,
      errors: [`Reserved compiler extension slots are not public: ${reserved.join(', ')}.`],
    }
  }
  return validateInternalIndexerExtensionManifest(extension)
}

/** Resolves trusted, already-installed manifests through the public declarative boundary. */
export function resolveIndexerExtensionReferences(
  input: ResolveIndexerExtensionReferencesInput = {},
): ResolveIndexerExtensionReferencesResult {
  return enforcePublicExtensionResults(resolveInternalIndexerExtensionReferences(input))
}

/** Loads configured packages and admits only public declarative extension manifests. */
export async function loadIndexerExtensionReferences(
  input: LoadIndexerExtensionReferencesInput,
): Promise<ResolveIndexerExtensionReferencesResult> {
  return enforcePublicExtensionResults(await loadInternalIndexerExtensionReferences(input))
}

function enforcePublicExtensionResults(
  result: ResolveIndexerExtensionReferencesResult,
): ResolveIndexerExtensionReferencesResult {
  const extensions: ResolvedIndexerExtension[] = []
  const diagnostics = [...result.diagnostics]

  for (const resolved of result.extensions) {
    const validation = validateIndexerExtensionManifest(resolved.extension)
    if (validation.valid) {
      extensions.push(resolved)
      continue
    }
    diagnostics.push({
      id: `index.extension_invalid_manifest:${resolved.reference.package}#${resolved.reference.export ?? 'default'}`,
      code: 'index.extension_invalid_manifest',
      severity: 'error',
      message: `Indexer extension ${resolved.extension.name} has an invalid public manifest: ${validation.errors.join(' ')}`,
    })
  }

  return { extensions, diagnostics }
}

function reservedExtensionSlots(extension: IndexerExtension): readonly string[] {
  const value = extension as unknown as Readonly<Record<string, unknown>>
  return RESERVED_EXTENSION_SLOTS.filter((slot) => slot in value)
}
