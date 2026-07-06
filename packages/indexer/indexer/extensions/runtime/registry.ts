import { IndexRuleManifestSchema, type IndexDiagnostic } from '@use-crux/core/project-index'
import { patternCallNames } from '../public-contract/patterns'
import { validateRelationSpecs } from '../public-contract/relation-specs'
import {
  createExtractorDispatchIndex,
  indexedExtractorsForCall,
  indexedExtractorsForNew,
  indexedExtractorsForObject,
  type ExtractorDispatchIndex,
  type RegisteredExtractor,
} from './registry-index'
import { compareCodepoint } from '../../sort'
import { ruleConflictDiagnostic } from './diagnostics'
import type { IndexRule, IndexerExtension } from '../public-contract/types'

export type { RegisteredExtractor } from './registry-index'

/**
 * Normalized, deterministic view of all extension contributions available to a compiler run.
 *
 * The registry is pure data: it does not execute extractors or retain mutable compiler state. Parser
 * code consumes it to decide which call names to scan for and which extractor should see a match.
 */
export interface ExtensionRegistry {
  readonly extensions: readonly IndexerExtension[]
  readonly extractors: readonly RegisteredExtractor[]
  readonly callNames: readonly string[]
  /** Precomputed dispatch tables used by static extraction hot paths. */
  readonly dispatchIndex: ExtractorDispatchIndex
  /** Recoverable registry problems surfaced to index diagnostics without aborting the request. */
  readonly diagnostics: readonly IndexDiagnostic[]
  /** Rule ids that were declared by multiple extensions and must not execute. */
  readonly conflictedRuleIds: ReadonlySet<string>
}

/**
 * Builds the immutable registry used by parser dispatch.
 *
 * Registry construction is where unordered extension manifests become deterministic compiler input:
 * extensions and extractors are sorted by name, relation specs are validated before extraction starts,
 * and call patterns are flattened into the parser prefilter. Keeping this as a pure normalization step
 * makes cache keys, diagnostics, and first-match extractor behavior reproducible.
 */
export function createExtensionRegistry(extensions: readonly IndexerExtension[]): ExtensionRegistry {
  const normalizedExtensions = [...extensions].sort((a, b) => compareCodepoint(a.name, b.name))
  const relationSpecErrors = validateRelationSpecs(
    normalizedExtensions.flatMap((extension) => extension.relations ?? []),
  )
  const relationNamespaceErrors = validateRelationNamespaces(normalizedExtensions)
  const ruleErrors = validateIndexRuleDeclarations(normalizedExtensions)
  const ruleNameConflicts = validateIndexRuleNameConflicts(normalizedExtensions)
  const ruleNamespaceErrors = validateRuleNamespaces(normalizedExtensions)
  const errors = [
    ...relationSpecErrors,
    ...relationNamespaceErrors,
    ...ruleErrors,
    ...ruleNameConflicts.errors,
    ...ruleNamespaceErrors,
  ]
  if (errors.length > 0) {
    throw new Error(`Invalid indexer extension declarations:\n${errors.join('\n')}`)
  }
  const extractors = normalizedExtensions.flatMap((extension) =>
    [...(extension.extractors ?? [])]
      .sort((a, b) => compareCodepoint(a.name, b.name))
      .map((extractor) => ({ extension, extractor })),
  )
  const dispatchIndex = createExtractorDispatchIndex(extractors)
  return {
    extensions: normalizedExtensions,
    extractors,
    callNames: patternCallNames(normalizedExtensions),
    dispatchIndex,
    diagnostics: ruleNameConflicts.diagnostics,
    conflictedRuleIds: ruleNameConflicts.conflictedRuleIds,
  }
}

/**
 * Validates that third-party relation types are namespaced by extension name.
 */
function validateRelationNamespaces(extensions: readonly IndexerExtension[]): readonly string[] {
  return extensions.flatMap((extension) => {
    if (isCruxOwnedExtension(extension.name)) return []
    return (extension.relations ?? [])
      .filter((spec) => !spec.type.startsWith(`${extension.name}/`))
      .map((spec) => `${extension.name}: relation ${spec.type} must be prefixed with ${extension.name}/.`)
  })
}

/**
 * Validates that third-party rule names are namespaced by extension name.
 */
function validateRuleNamespaces(extensions: readonly IndexerExtension[]): readonly string[] {
  return extensions.flatMap((extension) => {
    if (isCruxOwnedExtension(extension.name)) return []
    return (extension.rules ?? [])
      .filter((rule) => rule.manifest?.id && !rule.manifest.id.startsWith(`${extension.name}/`))
      .map((rule) => `${extension.name}: rule ${rule.manifest.id} must be prefixed with ${extension.name}/.`)
  })
}

/**
 * Returns whether an extension name is owned by Crux and may use built-in
 * namespaces.
 */
function isCruxOwnedExtension(name: string): boolean {
  return name === '@use-crux/indexer' || name.startsWith('@use-crux/')
}

/**
 * Validates all rule declarations in the registry input.
 */
function validateIndexRuleDeclarations(extensions: readonly IndexerExtension[]): readonly string[] {
  return extensions.flatMap((extension) =>
    (extension.rules ?? []).flatMap((rule) => validateIndexRuleDeclaration(extension.name, rule)),
  )
}

interface IndexRuleNameConflictResult {
  readonly errors: readonly string[]
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly conflictedRuleIds: ReadonlySet<string>
}

/**
 * Splits rule id collisions into fatal same-extension duplicates and recoverable cross-extension
 * conflicts.
 */
function validateIndexRuleNameConflicts(extensions: readonly IndexerExtension[]): IndexRuleNameConflictResult {
  const errors: string[] = []
  const ownersByRule = new Map<string, Set<string>>()
  for (const extension of extensions) {
    const seenInExtension = new Set<string>()
    for (const rule of extension.rules ?? []) {
      const ruleId = rule.manifest?.id
      if (!ruleId) continue
      if (seenInExtension.has(ruleId)) errors.push(`Duplicate index rule: ${ruleId}`)
      seenInExtension.add(ruleId)
      const owners = ownersByRule.get(ruleId) ?? new Set<string>()
      owners.add(extension.name)
      ownersByRule.set(ruleId, owners)
    }
  }

  const conflictedRuleIds = new Set<string>()
  const diagnostics = [...ownersByRule]
    .flatMap(([ruleId, owners]) => {
      if (owners.size < 2) return []
      const sortedOwners = [...owners].sort(compareCodepoint)
      conflictedRuleIds.add(ruleId)
      return [ruleConflictDiagnostic(ruleId, sortedOwners)]
    })
    .sort((left, right) => compareCodepoint(left.id, right.id))

  return { errors, diagnostics, conflictedRuleIds }
}

/**
 * Validates one rule declaration's required metadata.
 */
function validateIndexRuleDeclaration(extensionName: string, rule: IndexRule): readonly string[] {
  const errors = []
  if (!rule.manifest?.id?.trim()) errors.push(`${extensionName}: rule manifest.id is required.`)
  const ruleName = rule.manifest?.id ?? '(missing rule id)'
  if (rule.manifest) {
    const result = IndexRuleManifestSchema.safeParse(rule.manifest)
    if (!result.success) {
      errors.push(
        ...result.error.issues.map(
          (issue) =>
            `${extensionName}/${ruleName}: rule manifest is invalid at ${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
      )
    }
  }
  if (!rule.manifest?.docs?.description?.trim()) {
    errors.push(`${extensionName}/${ruleName}: rule manifest.docs.description is required.`)
  }
  if (!rule.manifest?.phase) errors.push(`${extensionName}/${ruleName}: rule manifest.phase is required.`)
  if (!rule.manifest?.requires || rule.manifest.requires.length === 0) {
    errors.push(`${extensionName}/${ruleName}: rule manifest.requires must contain at least one fact kind.`)
  }
  if (!rule.manifest?.fidelity) errors.push(`${extensionName}/${ruleName}: rule manifest.fidelity is required.`)
  if (!rule.manifest?.defaultSeverity) {
    errors.push(`${extensionName}/${ruleName}: rule manifest.defaultSeverity is required.`)
  }
  if (!rule.messages || Object.keys(rule.messages).length === 0) {
    errors.push(`${extensionName}/${ruleName}: rule messages must contain at least one message.`)
  }
  return errors
}

/**
 * Selects extractors eligible for a parsed call expression.
 *
 * The returned order is the registry's normalized order. Callers should run extractors in that order so
 * broad first-party patterns remain deterministic until import-aware matching becomes stricter.
 */
export function extractorsForCall(
  registry: ExtensionRegistry,
  callName: string,
  importSource?: string,
  importName?: string,
): readonly RegisteredExtractor[] {
  return indexedExtractorsForCall(registry.dispatchIndex, callName, importSource, importName)
}

/**
 * Selects extractors eligible for a parsed constructor expression.
 */
export function extractorsForNew(registry: ExtensionRegistry, constructorName: string): readonly RegisteredExtractor[] {
  return indexedExtractorsForNew(registry.dispatchIndex, constructorName)
}

/**
 * Selects extractors eligible for a parsed object literal expression.
 */
export function extractorsForObject(registry: ExtensionRegistry): readonly RegisteredExtractor[] {
  return indexedExtractorsForObject(registry.dispatchIndex)
}
