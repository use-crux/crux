import type {
  StaticEvidenceCompatibility,
  StaticCallInterest,
  StaticConstructorInterest,
  StaticEvidenceInterestManifest,
} from './types'
import type { ExtractPattern } from '../public-contract/extractor-types'
import type { IndexerExtension } from '../public-contract/manifest-types'

/** Builds a deterministic AST-free static evidence interest manifest for the runtime. */
export function staticInterestManifestFromExtensions(
  extensions: readonly IndexerExtension[],
): StaticEvidenceInterestManifest {
  const calls = new Map<string, StaticCallInterest>()
  const constructors = new Map<string, StaticConstructorInterest>()
  const definitions = new Set<string>()
  const relations = new Set<string>()
  const compatibilityReasons = new Set<string>()

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
      for (const pattern of extractor.patterns) {
        addPatternInterest(pattern, calls, constructors)
      }
    }
  }

  return stripEmptyInterests({
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
): void {
  if (pattern.kind === 'object') return
  if (pattern.kind === 'call') {
    const interest = {
      name: pattern.name,
      ...(pattern.importFrom ? { importFrom: [...pattern.importFrom] } : {}),
      ...(pattern.configArg !== undefined ? { configArg: pattern.configArg } : {}),
      source: 'extractor-pattern' as const,
    }
    calls.set(callInterestKey(interest), interest)
    return
  }
  const interest = {
    name: pattern.name,
    ...(pattern.importFrom ? { importFrom: [...pattern.importFrom] } : {}),
    ...(pattern.configArg !== undefined ? { configArg: pattern.configArg } : {}),
    source: 'extractor-pattern' as const,
  }
  constructors.set(constructorInterestKey(interest), interest)
}

function stripEmptyInterests(
  input: Required<Omit<StaticEvidenceInterestManifest, 'compatibility'>> & {
    readonly compatibility: StaticEvidenceCompatibility
  },
): StaticEvidenceInterestManifest {
  return {
    ...(input.calls.length > 0 ? { calls: input.calls } : {}),
    ...(input.constructors.length > 0 ? { constructors: input.constructors } : {}),
    ...(input.definitions.length > 0 ? { definitions: input.definitions } : {}),
    ...(input.relations.length > 0 ? { relations: input.relations } : {}),
    compatibility: input.compatibility,
  }
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
