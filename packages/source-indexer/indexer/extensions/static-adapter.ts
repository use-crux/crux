import type { CatalogExtractor, ExtractContext, ExtractedFacts, SourceIndexerExtension } from './types'
import { createDefinitionBuilder, createReferenceBuilder } from './builders'
import { createStaticObjectReader } from './object-reader'
import { createExtensionRegistry, extractorsForCall, type ExtensionRegistry } from './registry'
import type { CatalogExtractor as LegacyCatalogExtractor, StaticCallContext } from '../extractors/types'
import type { StaticFoundDefinition } from '../types'

export function legacyCatalogExtractor(extractor: LegacyCatalogExtractor): CatalogExtractor {
  return {
    name: extractor.name,
    patterns: extractor.callNames.map((name) => ({ kind: 'call', name })),
    extract: (ctx) => {
      const legacy = ctx.unstableNative?.legacyStaticContext
      if (!isLegacyStaticCallContext(legacy)) return { kind: 'none' }
      const found = extractor.extract(legacy)
      if (found?.kind !== 'found') return { kind: 'none' }
      return {
        kind: 'facts',
        facts: {
          definitions: [
            {
              variableName: found.variableName,
              definition: found.definition,
              ...(found.extraDefinitions ? { extraDefinitions: found.extraDefinitions } : {}),
            },
          ],
          references: found.relationRefs,
        },
      }
    },
  }
}

export function extractWithExtensionRegistry(
  registry: ExtensionRegistry,
  legacyCtx: StaticCallContext,
): StaticFoundDefinition | undefined {
  for (const { extension, extractor } of extractorsForCall(registry, legacyCtx.callName)) {
    const result = extractor.extract(createExtractContext(extension, extractor, legacyCtx))
    if (result.kind === 'facts') {
      const found = staticFoundDefinitionFromFacts(result.facts)
      if (found) return found
    }
  }
  return undefined
}

export function createStaticExtensionRegistry(extensions: readonly SourceIndexerExtension[]): ExtensionRegistry {
  return createExtensionRegistry(extensions)
}

function createExtractContext(
  extension: SourceIndexerExtension,
  extractor: CatalogExtractor,
  legacyCtx: StaticCallContext,
): ExtractContext {
  return {
    extension: { name: extension.name, version: extension.version },
    extractor: extractor.name,
    match: { kind: 'call', name: legacyCtx.callName },
    source: {
      root: legacyCtx.root,
      file: legacyCtx.file,
      variableName: legacyCtx.variableName,
      localName: legacyCtx.localName,
    },
    config: createStaticObjectReader(legacyCtx.objectArg),
    define: createDefinitionBuilder(),
    ref: createReferenceBuilder(),
    unstableNative: {
      legacyStaticContext: legacyCtx,
      typescript: {
        sourceFile: legacyCtx.sourceFile,
        call: legacyCtx.call,
        objectArg: legacyCtx.objectArg,
      },
    },
  }
}

function staticFoundDefinitionFromFacts(facts: ExtractedFacts): StaticFoundDefinition | undefined {
  const [primary, ...extra] = facts.definitions ?? []
  if (!primary) return undefined
  const extraDefinitions = [
    ...extra.map((item) => item.definition),
    ...(primary.extraDefinitions ?? []),
  ]
  return {
    variableName: primary.variableName,
    definition: primary.definition,
    relationRefs: [...(facts.references ?? [])],
    ...(extraDefinitions.length > 0 ? { extraDefinitions } : {}),
  }
}

function isLegacyStaticCallContext(value: unknown): value is StaticCallContext {
  return Boolean(value && typeof value === 'object' && 'callName' in value && 'variableName' in value)
}
