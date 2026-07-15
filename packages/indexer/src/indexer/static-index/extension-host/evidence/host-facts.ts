import type {
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleDescriptor,
  ProjectDefinition,
} from '@use-crux/core/project-index'
import type { StaticExtractionResult } from '../../../extensions/runtime/engine'
import type { ExtractedFacts, ExtractedSourceRef } from '../../../extensions/public-contract/types'
import type { StaticRelationRef } from '../../../types'
import {
  canonicalDefinitionExtractors,
  type ProjectIndexDefinitionExtractors,
  type ProjectIndexFactExtractorProvenance,
} from '../../../fact-provenance'
import { mediaPrimitiveManifest } from '../../../media/primitive-manifest'

const FIRST_PARTY_EXTENSION = '@use-crux/indexer/crux-core'

/** Grouped fact payload that Static Index finalization can merge directly. */
export interface StaticExtensionNativeFinalizeFacts {
  readonly definitions?: readonly ProjectDefinition[]
  readonly relationRefs?: readonly StaticExtensionNativeRelationRef[]
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  readonly diagnostics?: readonly IndexDiagnostic[]
  readonly lintFindings?: readonly IndexLintFinding[]
  readonly ruleDescriptors?: readonly IndexRuleDescriptor[]
  /** Exact extractor contributors keyed by emitted definition id. */
  readonly definitionExtractors?: ProjectIndexDefinitionExtractors
}

/** Relation-ref shape consumed by Rust Static Index finalization. */
export interface StaticExtensionNativeRelationRef {
  readonly ownerDefinitionId: string
  readonly type: string
  readonly fromId?: string
  readonly toId?: string
  readonly toVariable?: string
}

/**
 * Projects TS extractor output into the grouped native finalization shape.
 *
 * Native finalization owns relation binding. This adapter keeps TypeScript
 * extractors as fact producers by forwarding definitions, source refs,
 * diagnostics, and unresolved relation refs as JSON-safe data.
 */
export function nativeFinalizeFactsFromExtractionResults(
  results: readonly StaticExtractionResult[],
): StaticExtensionNativeFinalizeFacts {
  const definitions: ProjectDefinition[] = []
  const relationRefs: StaticExtensionNativeRelationRef[] = []
  const sourceRefs: ExtractedSourceRef[] = []
  const diagnostics: IndexDiagnostic[] = []
  const definitionExtractors: Record<string, ProjectIndexFactExtractorProvenance[]> = {}

  for (const result of results) {
    if (result.kind === 'no-match' || result.kind === 'none') continue
    const facts = extractedFacts(result)
    if (result.kind === 'degraded') diagnostics.push(...result.diagnostics)
    if (!facts) continue
    diagnostics.push(...(facts.diagnostics ?? []))
    sourceRefs.push(...(facts.sourceRefs ?? []))
    const definitionIds = appendDefinitions(definitions, facts)
    for (const definitionId of definitionIds) {
      ;(definitionExtractors[definitionId] ??= []).push(extractorProvenance(result))
    }
    const ownerDefinitionId = definitionIds[0]
    if (!ownerDefinitionId) continue
    relationRefs.push(...nativeRelationRefs(ownerDefinitionId, facts.references ?? []))
  }

  return stripEmptyNativeFacts({
    definitions,
    relationRefs,
    sourceRefs,
    diagnostics,
    definitionExtractors: canonicalDefinitionExtractors(definitionExtractors),
  })
}

/** Projects TS rule output into the grouped native finalization shape. */
export function nativeFinalizeFactsFromRuleOutput(input: {
  readonly lintFindings: readonly IndexLintFinding[]
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
  readonly diagnostics: readonly IndexDiagnostic[]
}): StaticExtensionNativeFinalizeFacts {
  return stripEmptyNativeFacts({
    lintFindings: input.lintFindings,
    ruleDescriptors: input.ruleDescriptors,
    diagnostics: input.diagnostics,
  })
}

function extractedFacts(result: StaticExtractionResult): ExtractedFacts | undefined {
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

function appendDefinitions(definitions: ProjectDefinition[], facts: ExtractedFacts): readonly string[] {
  const [primary, ...extra] = facts.definitions ?? []
  if (!primary) return []
  definitions.push(primary.definition)
  definitions.push(...extra.map((item) => item.definition))
  definitions.push(...(primary.extraDefinitions ?? []))
  return [
    primary.definition.id,
    ...extra.map((item) => item.definition.id),
    ...(primary.extraDefinitions ?? []).map((item) => item.id),
  ]
}

function extractorProvenance(result: Exclude<StaticExtractionResult, { readonly kind: 'no-match' }>): ProjectIndexFactExtractorProvenance {
  return isFirstPartyExtension(result.extension.name)
    ? { name: result.extractor }
    : { name: result.extractor, extension: result.extension }
}

function isFirstPartyExtension(name: string): boolean {
  return name === FIRST_PARTY_EXTENSION || name === mediaPrimitiveManifest.name
}

function nativeRelationRefs(
  ownerDefinitionId: string,
  references: readonly StaticRelationRef[],
): readonly StaticExtensionNativeRelationRef[] {
  return references.map((reference) => ({
    ownerDefinitionId: reference.fromId ?? ownerDefinitionId,
    type: reference.type,
    ...(reference.fromId ? { fromId: reference.fromId } : {}),
    ...(reference.toId ?? reference.fallbackToId ? { toId: reference.toId ?? reference.fallbackToId } : {}),
    ...(reference.toVariable ? { toVariable: reference.toVariable } : {}),
  }))
}

function stripEmptyNativeFacts(input: {
  readonly definitions?: readonly ProjectDefinition[]
  readonly relationRefs?: readonly StaticExtensionNativeRelationRef[]
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  readonly diagnostics?: readonly IndexDiagnostic[]
  readonly lintFindings?: readonly IndexLintFinding[]
  readonly ruleDescriptors?: readonly IndexRuleDescriptor[]
  readonly definitionExtractors?: ProjectIndexDefinitionExtractors
}): StaticExtensionNativeFinalizeFacts {
  return {
    ...(input.definitions?.length ? { definitions: input.definitions } : {}),
    ...(input.relationRefs?.length ? { relationRefs: input.relationRefs } : {}),
    ...(input.sourceRefs?.length ? { sourceRefs: input.sourceRefs } : {}),
    ...(input.diagnostics?.length ? { diagnostics: input.diagnostics } : {}),
    ...(input.lintFindings?.length ? { lintFindings: input.lintFindings } : {}),
    ...(input.ruleDescriptors?.length ? { ruleDescriptors: input.ruleDescriptors } : {}),
    ...(input.definitionExtractors ? { definitionExtractors: input.definitionExtractors } : {}),
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled static extension host fact result: ${JSON.stringify(value)}`)
}
