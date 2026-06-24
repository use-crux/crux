import { IndexRuleManifestSchema } from '@crux/core/project-index'
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
  const normalizedExtensions = [...extensions].sort((a, b) => a.name.localeCompare(b.name))
  const relationSpecErrors = validateRelationSpecs(
    normalizedExtensions.flatMap((extension) => extension.relations ?? []),
  )
  const relationNamespaceErrors = validateRelationNamespaces(normalizedExtensions)
  const ruleErrors = validateIndexRuleDeclarations(normalizedExtensions)
  const duplicateRuleErrors = validateUniqueIndexRuleNames(normalizedExtensions)
  const ruleNamespaceErrors = validateRuleNamespaces(normalizedExtensions)
  const errors = [
    ...relationSpecErrors,
    ...relationNamespaceErrors,
    ...ruleErrors,
    ...duplicateRuleErrors,
    ...ruleNamespaceErrors,
  ]
  if (errors.length > 0) {
    throw new Error(`Invalid indexer extension declarations:\n${errors.join('\n')}`)
  }
  const extractors = normalizedExtensions.flatMap((extension) =>
    [...(extension.extractors ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((extractor) => ({ extension, extractor })),
  )
  const dispatchIndex = createExtractorDispatchIndex(extractors)
  return {
    extensions: normalizedExtensions,
    extractors,
    callNames: patternCallNames(normalizedExtensions),
    dispatchIndex,
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
  return name === '@crux/indexer' || name.startsWith('@crux/')
}

/**
 * Validates all rule declarations in the registry input.
 */
function validateIndexRuleDeclarations(extensions: readonly IndexerExtension[]): readonly string[] {
  return extensions.flatMap((extension) =>
    (extension.rules ?? []).flatMap((rule) => validateIndexRuleDeclaration(extension.name, rule)),
  )
}

/**
 * Detects duplicate rule names across extensions.
 */
function validateUniqueIndexRuleNames(extensions: readonly IndexerExtension[]): readonly string[] {
  const names = extensions.flatMap((extension) => (extension.rules ?? []).map((rule) => rule.manifest?.id).filter(Boolean))
  return duplicateStrings(names).map((name) => `Duplicate index rule: ${name}`)
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
 * Returns sorted duplicate strings from an input collection.
 */
function duplicateStrings(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return [...duplicates].sort()
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
