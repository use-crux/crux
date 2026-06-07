import type { CatalogDiagnostic, ProjectDefinition, ProjectRelation } from '@crux/core/catalog'
import type { StaticCallContext } from '../extractors/types'
import type { StaticFoundDefinition } from '../types'
import {
  callbackSourceRefForProperty,
  helperSourceRefsForNode,
  resolvedSourceNodeForProperty,
  schemaPropertyWithSourceRef,
  sourceRefForProperty,
  sourceRefsForTemplateInterpolations,
} from '../ast/source-refs'
import { createDefinitionBuilder, createReferenceBuilder } from './builders'
import { createStaticArgumentReader, createStaticObjectReader } from './object-reader'
import { createExtensionRegistry, extractorsForCall, type ExtensionRegistry, type RegisteredExtractor } from './registry'
import { resolveStaticRelationReferences } from './resolvers'
import { staticFoundDefinitionFromExtractedFacts } from './static-normalizer'
import type {
  CatalogExtractor,
  ExtensionIdentity,
  ExtractContext,
  ExtractResult,
  ExtractedFacts,
  IndexDependency,
  RelationSpec,
  SourceIndexerExtension,
} from './types'

/**
 * Runtime capability currently implemented by the functional extension executor.
 */
export type ExtensionRuntimeCapability = 'static-extraction' | 'catalog-rules'

/**
 * Deterministic extractor identity used in diagnostics and cache inputs.
 */
export interface ExtractorIdentity {
  readonly extension: ExtensionIdentity
  readonly name: string
}

/**
 * Value manifest for one extension runtime instance.
 *
 * The manifest contains no executable parser state. It is safe to reuse across compiler calls and can
 * participate in cache-key construction.
 */
export interface ExtensionRuntimeManifest {
  readonly extensions: readonly ExtensionIdentity[]
  readonly extractors: readonly ExtractorIdentity[]
  readonly callNames: readonly string[]
  readonly relationSpecs: readonly RelationSpec[]
  readonly cacheInputs: readonly IndexDependency[]
  readonly capabilities: readonly ExtensionRuntimeCapability[]
}

/**
 * Parser-owned static extraction input consumed by the runtime adapter.
 */
export type StaticExtractionInput = StaticCallContext

/**
 * Observable runtime result for one static extraction attempt.
 */
export type StaticExtractionResult =
  | { readonly kind: 'no-match' }
  | {
      readonly kind: 'none'
      readonly extension: ExtensionIdentity
      readonly extractor: string
      readonly dependencies: readonly IndexDependency[]
      readonly diagnostics: readonly CatalogDiagnostic[]
    }
  | {
      readonly kind: 'matched'
      readonly extension: ExtensionIdentity
      readonly extractor: string
      readonly facts: ExtractedFacts
      readonly dependencies: readonly IndexDependency[]
      readonly diagnostics: readonly CatalogDiagnostic[]
    }
  | {
      readonly kind: 'degraded'
      readonly extension: ExtensionIdentity
      readonly extractor: string
      readonly facts?: ExtractedFacts
      readonly dependencies: readonly IndexDependency[]
      readonly diagnostics: readonly CatalogDiagnostic[]
    }

/**
 * Functional extension execution boundary owned by the Project Catalog Compiler.
 */
export interface SourceIndexerExtensionRuntime {
  readonly manifest: ExtensionRuntimeManifest
  readonly extractStatic: (input: StaticExtractionInput) => StaticExtractionResult
  readonly checkRules: (input: ExtensionRuleInput) => ExtensionRuleResult
}

/**
 * Input for runtime-owned compatibility projection into the current static parser shape.
 */
export interface StaticExtractionProjectionInput {
  readonly result: StaticExtractionResult
}

/**
 * Input for the built-in static reference resolution boundary.
 */
export interface ExtensionResolutionInput {
  readonly found: readonly StaticFoundDefinition[]
  readonly importedDefinitions?: ReadonlyMap<string, ProjectDefinition>
}

/**
 * Immutable relation-resolution output produced from extracted definitions and references.
 */
export interface ExtensionResolutionResult {
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly CatalogDiagnostic[]
}

/**
 * Input for extension catalog-rule execution.
 */
export interface ExtensionRuleInput {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

/**
 * Value output from extension catalog-rule execution.
 */
export interface ExtensionRuleResult {
  readonly outputs: readonly unknown[]
  readonly diagnostics: readonly CatalogDiagnostic[]
}

/**
 * Creates a pure value runtime for deterministic Source Indexer Extension execution.
 */
export function createSourceIndexerExtensionRuntime(input: {
  readonly extensions: readonly SourceIndexerExtension[]
}): SourceIndexerExtensionRuntime {
  const registry = createExtensionRegistry(input.extensions)
  return {
    manifest: manifestFromRegistry(registry),
    extractStatic: (staticInput) => extractStaticWithRegistry(registry, staticInput),
    checkRules: (ruleInput) => checkExtensionRules({ extensions: registry.extensions, ...ruleInput }),
  }
}

/**
 * Projects a runtime result into the legacy parser helper result.
 *
 * Degraded facts are considered safe facts for compatibility callers because diagnostics travel only
 * on the richer runtime result. Callers that need diagnostics should use `extractStatic(...)`.
 */
export function extractedFactsFromStaticExtractionResult(
  result: StaticExtractionResult,
): ExtractedFacts | undefined {
  switch (result.kind) {
    case 'matched':
      return result.facts
    case 'degraded':
      return result.facts
    case 'none':
    case 'no-match':
      return undefined
    default:
      return assertNever(result)
  }
}

/**
 * Projects runtime extraction output into the current static parser compatibility shape.
 */
export function staticFoundDefinitionFromStaticExtractionResult(
  input: StaticExtractionProjectionInput,
): StaticFoundDefinition | undefined {
  const facts = extractedFactsFromStaticExtractionResult(input.result)
  return facts ? staticFoundDefinitionFromExtractedFacts(facts) : undefined
}

/**
 * Resolves built-in static relation references through a runtime-adjacent functional boundary.
 *
 * Public resolver authoring remains reserved; this function makes the current built-in resolver phase
 * explicit without exposing parser or graph-builder internals.
 */
export function resolveExtensionReferences(input: ExtensionResolutionInput): ExtensionResolutionResult {
  return {
    relations: resolveStaticRelationReferences(
      input.found,
      input.importedDefinitions ? new Map(input.importedDefinitions) : undefined,
    ),
    diagnostics: [],
  }
}

/**
 * Runs extension catalog rules in deterministic extension/rule order.
 */
export function checkExtensionRules(input: ExtensionRuleInput & {
  readonly extensions: readonly SourceIndexerExtension[]
}): ExtensionRuleResult {
  const registry = createExtensionRegistry(input.extensions)
  return {
    outputs: registry.extensions.flatMap((extension) =>
      [...(extension.rules ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((rule) => rule.check({ definitions: input.definitions, relations: input.relations })),
    ),
    diagnostics: [],
  }
}

/**
 * Builds the deterministic runtime manifest from a normalized registry.
 */
function manifestFromRegistry(registry: ExtensionRegistry): ExtensionRuntimeManifest {
  const extensions = registry.extensions.map(extensionIdentity)
  const extractors = registry.extractors.map(({ extension, extractor }) => ({
    extension: extensionIdentity(extension),
    name: extractor.name,
  }))
  return {
    extensions,
    extractors,
    callNames: [...registry.callNames],
    relationSpecs: registry.extensions.flatMap((extension) => extension.relations ?? []).sort((a, b) => a.type.localeCompare(b.type)),
    cacheInputs: registry.extensions.flatMap((extension) => [
      { kind: 'extension' as const, name: extension.name, version: extension.version },
      ...registry.extractors
        .filter((item) => item.extension.name === extension.name)
        .map((item) => ({
          kind: 'extractor' as const,
          extension: item.extension.name,
          name: item.extractor.name,
        })),
    ]),
    capabilities: registry.extensions.some((extension) => (extension.rules ?? []).length > 0)
      ? ['static-extraction', 'catalog-rules']
      : ['static-extraction'],
  }
}

/**
 * Executes eligible static extractors in deterministic registry order.
 */
function extractStaticWithRegistry(
  registry: ExtensionRegistry,
  staticInput: StaticExtractionInput,
): StaticExtractionResult {
  const registered = extractorsForCall(
    registry,
    staticInput.callName,
    staticInput.importSource,
    staticInput.importName,
  )
  if (registered.length === 0) return { kind: 'no-match' }

  let noneResult: Extract<StaticExtractionResult, { readonly kind: 'none' }> | undefined
  for (const item of registered) {
    const result = item.extractor.extract(createExtractContext(item.extension, item.extractor, staticInput))
    const runtimeResult = runtimeResultFromExtractResult(item, result)
    if (runtimeResult.kind !== 'none') return runtimeResult
    noneResult ??= runtimeResult
  }

  return noneResult ?? { kind: 'no-match' }
}

function runtimeResultFromExtractResult(
  item: RegisteredExtractor,
  result: ExtractResult,
): Exclude<StaticExtractionResult, { readonly kind: 'no-match' }> {
  const identity = extensionIdentity(item.extension)
  const dependencies = runtimeDependencies(item, result.dependencies)
  switch (result.kind) {
    case 'facts':
      return {
        kind: 'matched',
        extension: identity,
        extractor: item.extractor.name,
        facts: result.facts,
        dependencies,
        diagnostics: [],
      }
    case 'none':
      return {
        kind: 'none',
        extension: identity,
        extractor: item.extractor.name,
        dependencies,
        diagnostics: [],
      }
    case 'degraded':
      return {
        kind: 'degraded',
        extension: identity,
        extractor: item.extractor.name,
        ...(result.facts ? { facts: result.facts } : {}),
        dependencies,
        diagnostics: [...result.diagnostics],
      }
    default:
      return assertNever(result)
  }
}

function runtimeDependencies(
  item: RegisteredExtractor,
  declared: readonly IndexDependency[] | undefined,
): readonly IndexDependency[] {
  return [
    { kind: 'extension', name: item.extension.name, version: item.extension.version },
    { kind: 'extractor', extension: item.extension.name, name: item.extractor.name },
    ...(declared ?? []),
  ]
}

function extensionIdentity(extension: SourceIndexerExtension): ExtensionIdentity {
  return { name: extension.name, version: extension.version }
}

/**
 * Adapts parser-owned static call data into the stable extractor context.
 *
 * TypeScript nodes remain compiler-owned and are exposed only through `unstableNative` for current
 * first-party migrations.
 */
export function createExtractContext(
  extension: SourceIndexerExtension,
  extractor: CatalogExtractor,
  staticCtx: StaticCallContext,
): ExtractContext {
  return {
    extension: { name: extension.name, version: extension.version },
    extractor: extractor.name,
    match: { kind: 'call', name: staticCtx.importName ?? staticCtx.callName },
    source: {
      root: staticCtx.root,
      file: staticCtx.file,
      variableName: staticCtx.variableName,
      localName: staticCtx.localName,
      safeId: staticCtx.safeId,
    },
    args: createStaticArgumentReader([...staticCtx.call.arguments], staticCtx.localInitializers),
    config: createStaticObjectReader(staticCtx.objectArg, staticCtx.localInitializers),
    define: createDefinitionBuilder(({ id, kind, name, metadata }) =>
      staticCtx.define(id, kind, name, staticCtx.objectArg, metadata),
    ),
    ref: createReferenceBuilder(),
    sourceRef: {
      property: ({ property, role, definitionId, metadata }) => {
        if (!staticCtx.objectArg) return undefined
        const ref = sourceRefForProperty({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          role,
          definitionId,
          ...(metadata ? { metadata } : {}),
        })
        return ref ? { definitionId, ref } : undefined
      },
      callbackProperty: ({ property, role, definitionId, metadata }) => {
        if (!staticCtx.objectArg) return undefined
        const ref = callbackSourceRefForProperty({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          role,
          definitionId,
          ...(metadata ? { metadata } : {}),
        })
        return ref ? { definitionId, ref } : undefined
      },
      templateInterpolations: ({ property, role, definitionId }) => {
        if (!staticCtx.objectArg) return []
        return sourceRefsForTemplateInterpolations({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          role,
          definitionId,
        }).map((ref) => ({ definitionId, ref }))
      },
      schemaProperty: ({ property, definitionId }) => {
        if (!staticCtx.objectArg) return { sourceRefs: [] }
        const result = schemaPropertyWithSourceRef({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
          definitionId,
        })
        return {
          ...(result.schema ? { schema: result.schema } : {}),
          sourceRefs: result.sourceRefs.map((ref) => ({ definitionId, ref })),
        }
      },
      helperRefsForProperty: ({ property, definitionId, maxDepth }) => {
        if (!staticCtx.objectArg) return []
        const resolved = resolvedSourceNodeForProperty({
          ...staticCtx,
          object: staticCtx.objectArg,
          property,
        })
        if (!resolved) return []
        return helperSourceRefsForNode({
          definitionId,
          root: staticCtx.root,
          file: resolved.sourceFile.fileName,
          sourceFile: resolved.sourceFile,
          node: resolved.node,
          localInitializers: resolved.localInitializers,
          ...(maxDepth !== undefined ? { maxDepth } : {}),
        }).map((ref) => ({ definitionId, ref }))
      },
    },
    unstableNative: {
      staticContext: staticCtx,
      typescript: {
        sourceFile: staticCtx.sourceFile,
        call: staticCtx.call,
        objectArg: staticCtx.objectArg,
      },
    },
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled extension runtime result: ${JSON.stringify(value)}`)
}
