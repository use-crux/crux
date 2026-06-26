import type {
  IndexDiagnostic,
  IndexFactKind,
  IndexLintFinding,
  IndexRuleDescriptor,
  ProjectDefinition,
  ProjectRelation,
} from '@use-crux/core/project-index'
import ts from 'typescript'
import type { StaticCallContext } from '../../extractors/types'
import type { StaticFoundDefinition } from '../../types'
import {
  callbackSourceRefForProperty,
  helperSourceRefsForNode,
  resolvedSourceNodeForProperty,
  schemaPropertyWithSourceRef,
  sourceRefForProperty,
  sourceRefsForTemplateInterpolations,
} from '../../ast/source-refs'
import { createDefinitionBuilder, createReferenceBuilder } from '../public-contract/builders'
import { createStaticArgumentReader, createStaticObjectReader } from '../../static-index/extension-host/evidence/object-reader'
import {
  createExtensionRegistry,
  extractorsForCall,
  extractorsForNew,
  extractorsForObject,
  type ExtensionRegistry,
} from './registry'
import { createNativeSyntaxHandle } from '../../static-index/compatibility/syntax-record-bridge/native-context'
import { extensionIdentity, runtimeResultFromExtractResult } from './results'
import { indexRuleAvailability } from './rule-availability'
import { staticFoundDefinitionFromExtractedFacts } from '../../static-index/compatibility/syntax-record-bridge/normalizer'
import { extractStaticRecordWithRegistry, type StaticRecordExtractionInput } from '../../static-index/compatibility/syntax-record-bridge/runtime'
import { staticInterestManifestFromExtensions } from '../../static-index/extension-host/evidence/interests'
import { staticExtensionHostManifest, type StaticExtensionHostManifest } from '../../static-index/extension-host/host-plan/host-manifest'
import type {
  IndexExtractor,
  ExtractPattern,
  ExtensionIdentity,
  ExtractContext,
  ExtractedFacts,
  IndexDependency,
  SemanticReadModel,
  RelationSpec,
  IndexerExtension,
} from '../public-contract/types'
import type { StaticEvidenceInterestManifest } from '../../static-index/extension-host/evidence/types'

/**
 * Feature area implemented by an extension runtime instance.
 *
 * Capabilities are part of cache identity and diagnostics, so they should describe observable
 * compiler behavior rather than internal implementation modules.
 */
export type ExtensionRuntimeCapability = 'static-extraction' | 'index-rules'

/**
 * Stable extractor identity used in diagnostics and cache inputs.
 *
 * The identity intentionally pairs the extractor name with its extension identity. Extractor names
 * only need to be unique within an extension package; cache keys must remain unambiguous across the
 * whole runtime.
 */
export interface ExtractorIdentity {
  readonly extension: ExtensionIdentity
  readonly name: string
  readonly patterns: readonly ExtractPattern[]
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
  readonly staticInterests: StaticEvidenceInterestManifest
  readonly staticHost: StaticExtensionHostManifest
  readonly relationSpecs: readonly RelationSpec[]
  readonly cacheInputs: readonly IndexDependency[]
  readonly capabilities: readonly ExtensionRuntimeCapability[]
}

/**
 * Parser-owned static extraction input consumed by the runtime adapter.
 *
 * This is the only place where TypeScript AST nodes cross into extension execution. Public extractor
 * APIs receive typed readers and builders from `ExtractContext`; first-party migration helpers can
 * unwrap a compiler-branded native handle without exposing TypeScript nodes as public API.
 */
export type StaticExtractionInput = StaticCallContext

/**
 * Observable runtime result for one static extraction attempt.
 *
 * `no-match` means no extractor pattern applied to the syntax node. `none` means an extractor matched
 * the syntax shape and deliberately declined to emit facts. `degraded` preserves partial facts and
 * diagnostics when static analysis could not fully understand an otherwise supported shape.
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
 *
 * A runtime is a pure, deterministic executor over a normalized extension registry. It exposes a
 * value manifest for cache identity and small execution methods for static facts and index rules; it
 * does not own file IO, persistent cache state, or project traversal.
 */
export interface IndexerExtensionRuntime {
  readonly manifest: ExtensionRuntimeManifest
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
  readonly extractStatic: (input: StaticExtractionInput) => StaticExtractionResult
  readonly extractStaticRecord: (input: StaticRecordExtractionInput) => StaticExtractionResult
  readonly checkRules: (input: ExtensionRuleInput) => ExtensionRuleResult
}

/**
 * Input for projecting runtime extraction output into the current relation resolver shape.
 *
 * This adapter is intentionally narrow while the compiler finishes migrating from parser-owned
 * definition projections to fact-first extension output.
 */
export interface StaticExtractionProjectionInput {
  readonly result: StaticExtractionResult
}

/**
 * Input for extension index-rule execution.
 *
 * Rules run after definitions and relations have been projected. When a semantic read model is
 * available, the runtime passes it through as optional context rather than making semantic analysis a
 * prerequisite for every rule.
 */
export interface ExtensionRuleInput {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly availableFacts?: readonly IndexFactKind[]
  readonly semantic?: SemanticReadModel
}

/**
 * Value output from extension index-rule execution.
 *
 * Diagnostics describe rule-execution problems. User-facing lint findings stay in `outputs` so
 * callers can separate compiler health from authored-project feedback.
 */
export interface ExtensionRuleResult {
  readonly outputs: readonly IndexLintFinding[]
  readonly diagnostics: readonly IndexDiagnostic[]
}

/**
 * Creates a pure value runtime for deterministic Crux Indexer Extension execution.
 *
 * The runtime normalizes extension order once, then uses that order for manifests, extraction, and
 * rule checks. Callers should create one runtime per configured extension set and pass it to the
 * static extraction engine.
 */
export function createIndexerExtensionRuntime(input: {
  readonly extensions: readonly IndexerExtension[]
}): IndexerExtensionRuntime {
  const registry = createExtensionRegistry(input.extensions)
  return {
    manifest: manifestFromRegistry(registry),
    ruleDescriptors: extensionRuleDescriptors(registry.extensions),
    extractStatic: (staticInput) => extractStaticWithRegistry(registry, staticInput),
    extractStaticRecord: (recordInput) => extractStaticRecordWithRegistry(registry, recordInput),
    checkRules: (ruleInput) => checkExtensionRules({ extensions: registry.extensions, ...ruleInput }),
  }
}

/**
 * Returns descriptors for extension-provided lint rules.
 *
 * Descriptors are sorted and stripped of internal adapter rules so the devtools catalog sees a stable,
 * user-facing list of configurable rules.
 */
export function extensionRuleDescriptors(extensions: readonly IndexerExtension[]): readonly IndexRuleDescriptor[] {
  const registry = createExtensionRegistry(extensions)
  return registry.extensions.flatMap((extension) =>
    [...(extension.rules ?? [])]
      .filter((rule) => !isInternalIndexLintAdapter(extension, rule.manifest.id))
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
      .map((rule) => {
        const messageIds = Object.keys(rule.messages).sort()
        return {
          id: rule.manifest.id,
          source: 'extension',
          extension: {
            name: extension.name,
            version: extension.version,
          },
          title: rule.manifest.docs.description,
          description: rule.manifest.docs.description,
          docsUrl: rule.manifest.docs.url,
          severity: rule.manifest.defaultSeverity,
          phase: rule.manifest.phase,
          requires: [...rule.manifest.requires],
          fidelity: rule.manifest.fidelity,
          optionSchema: rule.manifest.schema,
          messageIds,
          defaultOptions: rule.manifest.defaultOptions,
          budget: rule.manifest.budget,
        }
      }),
  )
}

/**
 * Hides the built-in lint adapter from public extension rule descriptors.
 */
function isInternalIndexLintAdapter(extension: IndexerExtension, ruleName: string): boolean {
  return extension.name === '@use-crux/indexer/crux-core' && ruleName === 'crux.index-lints'
}

/**
 * Projects a runtime result into fact output for the remaining parser/read-model adapter.
 *
 * Degraded facts are still useful: the compiler can index the subset it understood and carry
 * diagnostics alongside those facts. This function is temporary glue between the runtime result union
 * and the fact-first read model.
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
 * Projects runtime extraction output into the current static relation resolver shape.
 *
 * Prefer working with `ExtractedFacts` at new boundaries. This helper exists for code paths that still
 * need the normalized primary-definition shape consumed by the built-in relation resolver.
 */
export function staticFoundDefinitionFromStaticExtractionResult(
  input: StaticExtractionProjectionInput,
): StaticFoundDefinition | undefined {
  const facts = extractedFactsFromStaticExtractionResult(input.result)
  return facts ? staticFoundDefinitionFromExtractedFacts(facts) : undefined
}

/**
 * Runs extension index rules in deterministic extension/rule order.
 *
 * The runtime treats rule failures as rule implementation concerns; rules should return diagnostics
 * through their own contract rather than throwing for normal authored-project feedback.
 */
export function checkExtensionRules(
  input: ExtensionRuleInput & {
    readonly extensions: readonly IndexerExtension[]
  },
): ExtensionRuleResult {
  const registry = createExtensionRegistry(input.extensions)
  const outputs: IndexLintFinding[] = []
  const diagnostics: IndexDiagnostic[] = []
  for (const extension of registry.extensions) {
    const rules = [...(extension.rules ?? [])].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id))
    for (const rule of rules) {
      const availability = indexRuleAvailability(rule, input)
      if (!availability.available) {
        diagnostics.push(availability.diagnostic)
        continue
      }
      outputs.push(
        ...rule.check({
          definitions: input.definitions,
          relations: input.relations,
          ...(input.semantic ? { semantic: input.semantic } : {}),
        }),
      )
    }
  }
  return {
    outputs,
    diagnostics,
  }
}

/**
 * Builds the deterministic runtime manifest from a normalized registry.
 *
 * The manifest is a cache input as well as a devtools summary. It contains only serializable identity
 * data and never stores function references or AST state.
 */
function manifestFromRegistry(registry: ExtensionRegistry): ExtensionRuntimeManifest {
  const extensions = registry.extensions.map(extensionIdentity)
  const extractors = registry.extractors.map(({ extension, extractor }) => ({
    extension: extensionIdentity(extension),
    name: extractor.name,
    patterns: [...extractor.patterns],
  }))
  const staticInterests = staticInterestManifestFromExtensions(registry.extensions)
  return {
    extensions,
    extractors,
    callNames: [...registry.callNames],
    staticInterests,
    staticHost: staticExtensionHostManifest({
      extractors,
      staticInterests,
      typeScriptRuleCount: registry.extensions.reduce((count, extension) => count + (extension.rules?.length ?? 0), 0),
    }),
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
          name: rule.manifest.id,
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
 *
 * The first extractor that emits facts or degraded output wins. If every matching extractor declines
 * with `none`, the first `none` result is returned so diagnostics and identity still point at the
 * extractor that understood the syntax shape.
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

/**
 * Adapts parser call data to the object argument selected by an extractor pattern.
 *
 * The parser records the obvious first object literal for old and simple factory shapes. Extractor
 * patterns may declare `configArg` when their authored API keeps configuration in a different
 * argument slot, and this adapter swaps `objectArg` before readers/source refs are created.
 */
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

/**
 * Returns the configuration argument index for the extractor pattern that matched this call.
 *
 * Object-literal patterns already use the literal itself as configuration. Call and constructor
 * patterns are narrowed separately so TypeScript preserves the pattern-specific `name` and
 * `configArg` fields without casts.
 */
function extractorConfigArg(staticInput: StaticExtractionInput, extractor: IndexExtractor): number | undefined {
  if (ts.isObjectLiteralExpression(staticInput.call)) return undefined
  const kind = staticInput.call.kind === ts.SyntaxKind.NewExpression ? 'new' : 'call'
  for (const pattern of extractor.patterns) {
    switch (pattern.kind) {
      case 'call':
        if (kind !== 'call') continue
        if (pattern.name !== staticInput.callName && pattern.name !== staticInput.importName) continue
        return pattern.configArg
      case 'new':
        if (kind !== 'new') continue
        if (pattern.name !== staticInput.callName && pattern.name !== staticInput.importName) continue
        return pattern.configArg
      case 'object':
        continue
      default:
        return assertNever(pattern)
    }
  }
  return undefined
}

/**
 * Adapts parser-owned static call data into the stable extractor context.
 *
 * Extractors receive readers, builders, source-ref helpers, and stable source metadata instead of
 * needing to inspect TypeScript nodes directly. Native nodes remain compiler-owned and are exposed
 * only through a branded internal handle for current first-party migrations.
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
    internalNative: createNativeSyntaxHandle({
      staticContext: staticCtx,
      typescript: {
        sourceFile: staticCtx.sourceFile,
        call: staticCtx.call,
        objectArg: staticCtx.objectArg,
      },
    }),
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
