import type { ExtractedFacts } from '../../../extensions/public-contract/types'
import type { StaticFoundDefinition } from '../../../types'

/**
 * Projects one immutable fact contribution into the parser shape used by existing relation resolution.
 *
 * This is not an extension authoring API. It is the compatibility projection that lets the fact-first
 * compiler boundary feed the current index relation resolver while downstream index projection is
 * still represented as `StaticFoundDefinition`.
 */
export function staticFoundDefinitionFromExtractedFacts(facts: ExtractedFacts): StaticFoundDefinition | undefined {
  const [primary, ...extra] = facts.definitions ?? []
  if (!primary) return undefined
  const primarySourceRefs = (facts.sourceRefs ?? [])
    .filter((sourceRef) => sourceRef.definitionId === primary.definition.id)
    .map((sourceRef) => sourceRef.ref)
  const primaryDefinition = primarySourceRefs.length > 0
    ? {
        ...primary.definition,
        sourceRefs: [...(primary.definition.sourceRefs ?? []), ...primarySourceRefs],
      }
    : primary.definition
  const extraDefinitions = [
    ...extra.map((item) => item.definition),
    ...(primary.extraDefinitions ?? []),
  ]
  return {
    variableName: primary.variableName,
    definition: primaryDefinition,
    relationRefs: [...(facts.references ?? [])],
    ...(extraDefinitions.length > 0 ? { extraDefinitions } : {}),
  }
}

/**
 * Projects many fact contributions into parser definitions and drops contributions without a primary definition.
 *
 * Dropping empty fact sets here keeps extractor authors free to return `none()` or fact objects that
 * only become useful to later phases without forcing placeholder index definitions into the current
 * static parser projection.
 */
export function staticFoundDefinitionsFromExtractedFacts(facts: readonly ExtractedFacts[]): StaticFoundDefinition[] {
  return facts.map(staticFoundDefinitionFromExtractedFacts).filter(isDefined)
}

/** Removes empty fact projections after the normalizer has deliberately skipped unsupported inputs. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
