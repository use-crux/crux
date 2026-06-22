import type {
  StaticCalleeRecord,
  StaticSyntaxCallInterest,
  StaticSyntaxConstructorInterest,
} from './types'

/** Normalized import-aware match policy used by syntax frontends. */
export interface StaticSyntaxCalleeMatcher {
  /** Names worth using as cheap traversal needles. */
  readonly names: ReadonlySet<string>
  /** Returns whether a parsed callee should be retained. */
  allows(callee: StaticCalleeRecord): boolean
  /** Returns bounded evidence slicing for a retained callee, or `undefined` when full evidence is required. */
  evidenceFor(callee: StaticCalleeRecord): StaticSyntaxEvidenceSlice | undefined
}

/** Bounded object/config evidence selected by declared extension interests. */
export interface StaticSyntaxEvidenceSlice {
  /** Object/config argument index for positional APIs. */
  readonly configArg?: number
  /** Config property names to retain. Empty means the config object can be omitted. */
  readonly properties: ReadonlySet<string>
}

interface StaticSyntaxCalleeMatcherInput {
  readonly names?: readonly string[]
  readonly interests?: readonly StaticSyntaxCallInterest[] | readonly StaticSyntaxConstructorInterest[]
  readonly defaultNames?: readonly string[]
}

type Interest = StaticSyntaxCallInterest | StaticSyntaxConstructorInterest

/**
 * Creates a deterministic callee matcher from legacy broad names and
 * structured import-aware interests.
 */
export function createStaticSyntaxCalleeMatcher(
  input: StaticSyntaxCalleeMatcherInput,
): StaticSyntaxCalleeMatcher {
  const interests = input.interests ?? []
  const interestNames = new Set(interests.map((interest) => interest.name))
  const broadNames = new Set<string>()
  const importedNames = new Map<string, ReadonlySet<string>>()

  for (const interest of interests) {
    if (!interest.importFrom || interest.importFrom.length === 0) {
      broadNames.add(interest.name)
      continue
    }
    importedNames.set(interest.name, new Set([...(importedNames.get(interest.name) ?? []), ...interest.importFrom]))
  }

  for (const name of input.names ?? []) {
    if (!interestNames.has(name)) broadNames.add(name)
  }
  for (const name of input.defaultNames ?? []) {
    if (!interestNames.has(name)) broadNames.add(name)
  }

  const names = new Set([...broadNames, ...importedNames.keys()])
  const allowAll = names.size === 0 && interests.length === 0 && (input.names?.length ?? 0) === 0

  return Object.freeze({
    names,
    allows: (callee: StaticCalleeRecord): boolean => {
      if (allowAll) return true
      if (broadNames.has(callee.name) || Boolean(callee.localName && broadNames.has(callee.localName))) {
        return true
      }
      const importName = callee.importedName ?? callee.name
      const sources = importedNames.get(importName)
      return Boolean(callee.moduleSpecifier && sources?.has(callee.moduleSpecifier))
    },
    evidenceFor: (callee: StaticCalleeRecord): StaticSyntaxEvidenceSlice | undefined => {
      if (allowAll) return undefined
      const matching = interests.filter((interest) => interestMatchesCallee(interest, callee))
      if (matching.length === 0 || matching.some((interest) => interest.source !== 'manifest')) return undefined
      const properties = new Set<string>()
      let configArg: number | undefined
      for (const interest of matching) {
        if (interest.configArg !== undefined) configArg = Math.min(configArg ?? interest.configArg, interest.configArg)
        for (const property of interest.properties ?? []) properties.add(property)
        for (const callback of interest.callbacks ?? []) properties.add(callback.property)
      }
      return { ...(configArg !== undefined ? { configArg } : {}), properties }
    },
  })
}

function interestMatchesCallee(interest: Interest, callee: StaticCalleeRecord): boolean {
  const authoredName = interest.importFrom ? (callee.importedName ?? callee.name) : callee.name
  if (interest.name !== authoredName && interest.name !== callee.localName) return false
  if (!interest.importFrom || interest.importFrom.length === 0) return true
  return Boolean(callee.moduleSpecifier && interest.importFrom.includes(callee.moduleSpecifier))
}
