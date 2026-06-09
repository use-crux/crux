import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleDescriptor,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/project-index'
import ts from 'typescript'
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
import {
  createExtensionRegistry,
  extractorsForCall,
  extractorsForNew,
  extractorsForObject,
  type ExtensionRegistry,
  type RegisteredExtractor,
} from './registry'
import { resolveStaticRelationReferences } from './resolvers'
import { staticFoundDefinitionFromExtractedFacts } from './static-normalizer'
import type {
  IndexExtractor,
  ExtensionIdentity,
  ExtractContext,
  ExtractResult,
  ExtractedFacts,
  IndexDependency,
  SemanticReadModel,
  RelationSpec,
  IndexerExtension,
} from './types'

/**
 * Runtime capability currently implemented by the functional extension executor.
 */
export type ExtensionRuntimeCapability = 'static-extraction' | 'index-rules'

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
      readonly diagnostics: readonly IndexDiagnostic[]
    }
  | {
      readonly kind: 'matched'
      readonly extension: ExtensionIdentity
      readonly extractor: string
      readonly facts: ExtractedFacts
      readonly dependencies: readonly IndexDependency[]
      readonly diagnostics: readonly IndexDiagnostic[]
    }
  | {
      readonly kind: 'degraded'
      readonly extension: ExtensionIdentity
      readonly extractor: string
      readonly facts?: ExtractedFacts
      readonly dependencies: readonly IndexDependency[]
      readonly diagnostics: readonly IndexDiagnostic[]
    }

/**
 * Functional extension execution boundary owned by the Project Index Compiler.
 */
export interface IndexerExtensionRuntime {
  readonly manifest: ExtensionRuntimeManifest
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
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
  readonly diagnostics: readonly IndexDiagnostic[]
}

/**
 * Input for extension index-rule execution.
 */
export interface ExtensionRuleInput {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly semantic?: SemanticReadModel
}

/**
 * Value output from extension index-rule execution.
 */
export interface ExtensionRuleResult {
  readonly outputs: readonly IndexLintFinding[]
  readonly diagnostics: readonly IndexDiagnostic[]
}

/**
 * Creates a pure value runtime for deterministic Crux Indexer Extension execution.
 */
export function createIndexerExtensionRuntime(input: {
  readonly extensions: readonly IndexerExtension[]
}): IndexerExtensionRuntime {
  const registry = createExtensionRegistry(input.extensions)
  return {
    manifest: manifestFromRegistry(registry),
    ruleDescriptors: extensionRuleDescriptors(registry.extensions),
    extractStatic: (staticInput) => extractStaticWithRegistry(registry, staticInput),
    checkRules: (ruleInput) => checkExtensionRules({ extensions: registry.extensions, ...ruleInput }),
  }
}

/**
 * Returns descriptors for extension-provided lint rules.
 */
export function extensionRuleDescriptors(extensions: readonly IndexerExtension[]): readonly IndexRuleDescriptor[] {
  const registry = createExtensionRegistry(extensions)
  return registry.extensions.flatMap((extension) =>
    [...(extension.rules ?? [])]
      .filter((rule) => !isInternalIndexLintAdapter(extension, rule.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((rule) => {
        const messageIds = Object.keys(rule.meta.messages).sort()
        return {
          id: rule.name,
          source: 'extension',
          extension: {
            name: extension.name,
            version: extension.version,
          },
          title: rule.meta.docs.description,
          description: rule.meta.docs.description,
          docsUrl: rule.meta.docs.url,
          requires: rule.requires ? [...rule.requires] : undefined,
          optionSchema: rule.meta.schema,
          messageIds,
          defaultOptions: rule.meta.defaultOptions ? [...rule.meta.defaultOptions] : undefined,
        }
      }),
  )
}

/**
 * Hides the built-in lint adapter from public extension rule descriptors.
 */
function isInternalIndexLintAdapter(extension: IndexerExtension, ruleName: string): boolean {
  return extension.name === '@crux/indexer/crux-core' && ruleName === 'crux.index-lints'
}

/**
 * Projects a runtime result into the legacy parser helper result.
 *
 * Degraded facts are considered safe facts for compatibility callers because diagnostics travel only
 * on the richer runtime result. Callers that need diagnostics should use `extractStatic(...)`.
 */
export function extractedFactsFromStaticExtractionResult(result: StaticExtractionResult): ExtractedFacts | undefined {
  switch (result.kind) {
    case 'matched':
      return {
        ...result.facts,
        dependencies: mergeDependencies(result.facts.dependencies, result.dependencies),
      }
    case 'degraded':
      return result.facts || result.diagnostics.length > 0
        ? {
            ...(result.facts ?? {}),
            diagnostics: [...(result.facts?.diagnostics ?? []), ...result.diagnostics],
            dependencies: mergeDependencies(result.facts?.dependencies, result.dependencies),
          }
        : undefined
    case 'none':
    case 'no-match':
      return undefined
    default:
      return assertNever(result)
  }
}

/**
 * Merges dependency arrays while preserving first-seen order.
 */
function mergeDependencies(
  first: readonly IndexDependency[] | undefined,
  second: readonly IndexDependency[],
): readonly IndexDependency[] {
  const seen = new Set<string>()
  const dependencies = []
  for (const dependency of [...(first ?? []), ...second]) {
    const key = JSON.stringify(dependency)
    if (seen.has(key)) continue
    seen.add(key)
    dependencies.push(dependency)
  }
  return dependencies
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
 * Runs extension index rules in deterministic extension/rule order.
 */
export function checkExtensionRules(
  input: ExtensionRuleInput & {
    readonly extensions: readonly IndexerExtension[]
  },
): ExtensionRuleResult {
  const registry = createExtensionRegistry(input.extensions)
  return {
    outputs: registry.extensions.flatMap((extension) =>
      [...(extension.rules ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name))
        .flatMap((rule) =>
          rule.check({
            definitions: input.definitions,
            relations: input.relations,
            ...(input.semantic ? { semantic: input.semantic } : {}),
          }),
        ),
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
    relationSpecs: registry.extensions
      .flatMap((extension) => extension.relations ?? [])
      .sort((a, b) => a.type.localeCompare(b.type)),
    cacheInputs: registry.extensions.flatMap((extension) => [
      { kind: 'extension' as const, name: extension.name, version: extension.version },
      ...registry.extractors
        .filter((item) => item.extension.name === extension.name)
        .map((item) => ({
          kind: 'extractor' as const,
          extension: item.extension.name,
          name: item.extractor.name,
        })),
      ...(extension.rules ?? [])
        .map((rule) => ({
          kind: 'rule' as const,
          extension: extension.name,
          name: rule.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    ]),
    capabilities: registry.extensions.some((extension) => (extension.rules ?? []).length > 0)
      ? ['static-extraction', 'index-rules']
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
  const registered =
    ts.isObjectLiteralExpression(staticInput.call)
      ? extractorsForObject(registry)
      : staticInput.call.kind === ts.SyntaxKind.NewExpression
        ? extractorsForNew(registry, staticInput.callName)
        : extractorsForCall(registry, staticInput.callName, staticInput.importSource, staticInput.importName)
  if (registered.length === 0) return { kind: 'no-match' }

  let noneResult: Extract<StaticExtractionResult, { readonly kind: 'none' }> | undefined
  for (const item of registered) {
    const result = item.extractor.extract(
      createExtractContext(item.extension, item.extractor, staticInputForExtractor(staticInput, item.extractor)),
    )
    const runtimeResult = runtimeResultFromExtractResult(item, result)
    if (runtimeResult.kind !== 'none') return runtimeResult
    noneResult ??= runtimeResult
  }

  return noneResult ?? { kind: 'no-match' }
}

function staticInputForExtractor(
  staticInput: StaticExtractionInput,
  extractor: IndexExtractor,
): StaticExtractionInput {
  const configArg = extractorConfigArg(staticInput, extractor)
  if (configArg === undefined) return staticInput
  const arg = callArguments(staticInput.call)[configArg]
  if (!arg || !ts.isObjectLiteralExpression(arg)) return staticInput
  return { ...staticInput, objectArg: arg }
}

function extractorConfigArg(staticInput: StaticExtractionInput, extractor: IndexExtractor): number | undefined {
  if (ts.isObjectLiteralExpression(staticInput.call)) return undefined
  const kind = staticInput.call.kind === ts.SyntaxKind.NewExpression ? 'new' : 'call'
  for (const pattern of extractor.patterns) {
    if (kind === 'new' && pattern.kind !== 'new') continue
    if (kind === 'call' && pattern.kind !== 'call') continue
    if (pattern.name !== staticInput.callName && pattern.name !== staticInput.importName) continue
    return pattern.configArg
  }
  return undefined
}

/**
 * Converts an extractor return value into the normalized runtime result shape.
 */
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

/**
 * Adds extension/extractor identity dependencies to extractor-declared
 * dependencies.
 */
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

/**
 * Returns the stable extension identity used in diagnostics and cache inputs.
 */
function extensionIdentity(extension: IndexerExtension): ExtensionIdentity {
  return { name: extension.name, version: extension.version }
}

/**
 * Adapts parser-owned static call data into the stable extractor context.
 *
 * TypeScript nodes remain compiler-owned and are exposed only through `internalNative` for current
 * first-party migrations.
 */
export function createExtractContext(
  extension: IndexerExtension,
  extractor: IndexExtractor,
  staticCtx: StaticCallContext,
): ExtractContext {
  const matchKind = ts.isObjectLiteralExpression(staticCtx.call)
    ? 'object'
    : staticCtx.call.kind === ts.SyntaxKind.NewExpression
      ? 'new'
      : 'call'
  return {
    extension: { name: extension.name, version: extension.version },
    extractor: extractor.name,
    match: { kind: matchKind, name: staticCtx.importName ?? staticCtx.callName },
    source: {
      root: staticCtx.root,
      file: staticCtx.file,
      variableName: staticCtx.variableName,
      localName: staticCtx.localName,
      safeId: staticCtx.safeId,
    },
    args: createStaticArgumentReader(callArguments(staticCtx.call), staticCtx.localInitializers),
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
    internalNative: {
      staticContext: staticCtx,
      typescript: {
        sourceFile: staticCtx.sourceFile,
        call: staticCtx.call,
        objectArg: staticCtx.objectArg,
      },
    },
  }
}

/**
 * Returns call or constructor arguments as an immutable array.
 */
function callArguments(expression: ts.Expression): readonly ts.Expression[] {
  return ts.isCallExpression(expression) || ts.isNewExpression(expression) ? [...(expression.arguments ?? [])] : []
}

/**
 * Exhaustiveness helper for extension runtime discriminated unions.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled extension runtime result: ${JSON.stringify(value)}`)
}
