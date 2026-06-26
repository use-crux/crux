import type {
  StaticEvidenceCompatibility,
  StaticCallInterest,
  StaticConstructorInterest,
  StaticEvidenceExtractorInterest,
  StaticEvidenceInterestManifest,
} from './types'
import type { ExtractPattern } from '../../../extensions/public-contract/extractor-types'
import type { IndexerExtension } from '../../../extensions/public-contract/manifest-types'

/** Builds a deterministic AST-free static evidence interest manifest for the runtime. */
export function staticInterestManifestFromExtensions(
  extensions: readonly IndexerExtension[],
): StaticEvidenceInterestManifest {
  const calls = new Map<string, StaticCallInterest>()
  const constructors = new Map<string, StaticConstructorInterest>()
  const definitions = new Set<string>()
  const relations = new Set<string>()
  const compatibilityReasons = new Set<string>()
  const extractors: StaticEvidenceExtractorInterest[] = []

  for (const extension of extensions) {
    const evidence = extension.static?.evidence
    if (extension.extractors?.length && evidence?.mode !== 'declared') {
      compatibilityReasons.add(evidence?.reason ?? `${extension.name} has not declared bounded static evidence.`)
    }
    if (evidence?.mode === 'compatibility') {
      compatibilityReasons.add(evidence.reason ?? `${extension.name} requested compatibility static evidence.`)
    }
    for (const definition of extension.static?.interests?.definitions ?? []) definitions.add(definition)
    for (const relation of extension.static?.interests?.relations ?? []) relations.add(relation)
    for (const call of extension.static?.interests?.calls ?? []) {
      calls.set(callInterestKey(call), { ...call, source: call.source ?? 'manifest' })
    }
    for (const constructor of extension.static?.interests?.constructors ?? []) {
      constructors.set(constructorInterestKey(constructor), {
        ...constructor,
        source: constructor.source ?? 'manifest',
      })
    }
    for (const extractor of extension.extractors ?? []) {
      const extractorCalls = new Map<string, StaticCallInterest>()
      const extractorConstructors = new Map<string, StaticConstructorInterest>()
      for (const pattern of extractor.patterns) {
        addPatternInterest(pattern, calls, constructors)
        addPatternInterest(pattern, extractorCalls, extractorConstructors, {
          calls: extension.static?.interests?.calls ?? [],
          constructors: extension.static?.interests?.constructors ?? [],
        })
      }
      extractors.push(
        stripEmptyExtractorInterest({
          extension: { name: extension.name, version: extension.version },
          name: extractor.name,
          calls: [...extractorCalls.values()].sort(compareCalls),
          constructors: [...extractorConstructors.values()].sort(compareConstructors),
        }),
      )
    }
  }

  return stripEmptyInterests({
    extractors: extractors.sort(compareExtractors),
    calls: [...calls.values()].sort(compareCalls),
    constructors: [...constructors.values()].sort(compareConstructors),
    definitions: [...definitions].sort(),
    relations: [...relations].sort(),
    ...(compatibilityReasons.size > 0
      ? {
          compatibility: {
            mode: 'compatibility',
            reason: [...compatibilityReasons].sort().join(' '),
          },
        }
      : { compatibility: { mode: 'declared' } }),
  })
}

function addPatternInterest(
  pattern: ExtractPattern,
  calls: Map<string, StaticCallInterest>,
  constructors: Map<string, StaticConstructorInterest>,
  declarations?: {
    readonly calls: readonly StaticCallInterest[]
    readonly constructors: readonly StaticConstructorInterest[]
  },
): void {
  if (pattern.kind === 'object') return
  if (pattern.kind === 'call') {
    const base = {
      name: pattern.name,
      ...(pattern.importFrom ? { importFrom: [...pattern.importFrom] } : {}),
      ...(pattern.configArg !== undefined ? { configArg: pattern.configArg } : {}),
      source: 'extractor-pattern' as const,
    }
    const interest = { ...base, ...matchingCallDeclaration(base, declarations?.calls) }
    calls.set(callInterestKey(interest), interest)
    return
  }
  const base = {
    name: pattern.name,
    ...(pattern.importFrom ? { importFrom: [...pattern.importFrom] } : {}),
    ...(pattern.configArg !== undefined ? { configArg: pattern.configArg } : {}),
    source: 'extractor-pattern' as const,
  }
  const interest = { ...base, ...matchingConstructorDeclaration(base, declarations?.constructors) }
  constructors.set(constructorInterestKey(interest), interest)
}

function stripEmptyInterests(
  input: Required<Omit<StaticEvidenceInterestManifest, 'compatibility'>> & {
    readonly compatibility: StaticEvidenceCompatibility
  },
): StaticEvidenceInterestManifest {
  return {
    ...(input.extractors.length > 0 ? { extractors: input.extractors } : {}),
    ...(input.calls.length > 0 ? { calls: input.calls } : {}),
    ...(input.constructors.length > 0 ? { constructors: input.constructors } : {}),
    ...(input.definitions.length > 0 ? { definitions: input.definitions } : {}),
    ...(input.relations.length > 0 ? { relations: input.relations } : {}),
    compatibility: input.compatibility,
  }
}

function stripEmptyExtractorInterest(
  input: StaticEvidenceExtractorInterest & {
    readonly calls: readonly StaticCallInterest[]
    readonly constructors: readonly StaticConstructorInterest[]
  },
): StaticEvidenceExtractorInterest {
  return {
    extension: input.extension,
    name: input.name,
    ...(input.calls.length > 0 ? { calls: input.calls } : {}),
    ...(input.constructors.length > 0 ? { constructors: input.constructors } : {}),
  }
}

function matchingCallDeclaration(
  pattern: StaticCallInterest,
  declarations: readonly StaticCallInterest[] = [],
): Partial<StaticCallInterest> {
  return declarations.find((declaration) => callDeclarationMatches(pattern, declaration)) ?? {}
}

function matchingConstructorDeclaration(
  pattern: StaticConstructorInterest,
  declarations: readonly StaticConstructorInterest[] = [],
): Partial<StaticConstructorInterest> {
  return declarations.find((declaration) => constructorDeclarationMatches(pattern, declaration)) ?? {}
}

function callDeclarationMatches(pattern: StaticCallInterest, declaration: StaticCallInterest): boolean {
  return pattern.name === declaration.name && importFromMatches(pattern.importFrom, declaration.importFrom)
}

function constructorDeclarationMatches(
  pattern: StaticConstructorInterest,
  declaration: StaticConstructorInterest,
): boolean {
  return pattern.name === declaration.name && importFromMatches(pattern.importFrom, declaration.importFrom)
}

function importFromMatches(pattern: readonly string[] | undefined, declaration: readonly string[] | undefined): boolean {
  if (!pattern?.length) return true
  if (!declaration?.length) return false
  return pattern.every((specifier) => declaration.includes(specifier))
}

function compareExtractors(a: StaticEvidenceExtractorInterest, b: StaticEvidenceExtractorInterest): number {
  return `${a.extension.name}:${a.name}`.localeCompare(`${b.extension.name}:${b.name}`)
}

function compareCalls(a: StaticCallInterest, b: StaticCallInterest): number {
  return callInterestKey(a).localeCompare(callInterestKey(b))
}

function compareConstructors(a: StaticConstructorInterest, b: StaticConstructorInterest): number {
  return constructorInterestKey(a).localeCompare(constructorInterestKey(b))
}

function callInterestKey(interest: StaticCallInterest): string {
  return `${interest.name}:${(interest.importFrom ?? []).join('|')}:${interest.configArg ?? ''}:${interest.source ?? ''}`
}

function constructorInterestKey(interest: StaticConstructorInterest): string {
  return `${interest.name}:${(interest.importFrom ?? []).join('|')}:${interest.configArg ?? ''}:${interest.source ?? ''}`
}
