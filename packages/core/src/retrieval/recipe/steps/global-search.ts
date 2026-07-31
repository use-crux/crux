/**
 * Global search over Connected Knowledge community reports.
 *
 * @module
 *
 * @example
 * ```ts
 * const recipe = docs.recipe({
 *   steps: [globalSearch({ model, detail: 'overview' })],
 * })
 * const findings = await recipe.retrieve('What changed in the launch plan?')
 * ```
 */

import type { KnowledgeModel } from '../../../knowledge/model'
import { markBuiltInRetrievalStep, retrievalStep, type RetrievalStep } from '../step'
import { resolveGlobalSearchFreshness } from './global-search-freshness'
import {
  filterUnitsByDetail,
  mapGlobalSearchBatches,
  packBatches,
  reduceGlobalSearchCandidates,
  selectDetail,
} from './global-search-map'
import {
  GLOBAL_SEARCH_ADAPTIVE_THRESHOLD,
  GLOBAL_SEARCH_MAX_CALLS,
  type GlobalSearchDetail,
  type GlobalSearchScan,
  type SearchUnit,
} from './global-search-types'

/** Configuration for {@link globalSearch}. */
export interface GlobalSearchConfig {
  readonly model: KnowledgeModel
  readonly scan?: GlobalSearchScan
  readonly detail?: GlobalSearchDetail
  readonly limit?: number
}

/** Create a Connected Knowledge global-search producer step. */
export function globalSearch(config: GlobalSearchConfig): RetrievalStep<'queries', 'hits'> {
  const scan = config.scan ?? 'all'
  const configuredDetail = config.detail ?? 'auto'
  const limit = Math.max(1, Math.floor(config.limit ?? 20))

  return markBuiltInRetrievalStep(
    retrievalStep({
      id: 'global-search',
      kind: 'global-search',
      phase: { in: 'queries', out: 'hits' },
      model: config.model,
      needsModel: true,
      async run(input, context) {
        if (!context.communities) {
          throw new Error(
            'globalSearch() requires connected knowledge communities. Configure knowledgeBase({ communities: communities({ model }) }) and run it through knowledgeBase().recipe(...) or view.recipe(...).',
          )
        }
        if (context.request.filter) {
          throw new Error('globalSearch() does not accept request filters. Create a typed knowledge view and call view.recipe(...) instead.')
        }

        const query = input.queries.map((planned) => planned.query).join('\n')
        const fresh = await resolveGlobalSearchFreshness(context.communities)
        const detail = selectDetail({
          configured: configuredDetail,
          query,
          generations: fresh.generations,
          strategyFingerprint: context.communities.strategyFingerprint,
          modelFingerprint: config.model.fingerprint,
          scan,
          limit,
        })
        const availableUnits = filterUnitsByDetail(fresh.units, detail)
        const selectedUnits = scan === 'adaptive' ? adaptiveUnits(availableUnits) : availableUnits
        const batches = packBatches(selectedUnits)
        const preflight = {
          reports: selectedUnits.length,
          batches: batches.length,
          inputChars: batches.reduce((sum, batch) => sum + batch.inputChars, 0),
          calls: batches.length,
        }
        const admission = context.request.admit?.({
          kind: 'global-search',
          ...preflight,
        })
        if (admission === false) {
          throw new Error('globalSearch() was rejected by the request admission hook before map calls.')
        }
        if (!context.request.admit && preflight.calls > GLOBAL_SEARCH_MAX_CALLS) {
          throw new Error(
            `globalSearch() estimated ${preflight.calls} map calls for ${preflight.reports} reports, above the ${GLOBAL_SEARCH_MAX_CALLS} call ceiling. Remedies: use detail: 'overview', use scan: 'adaptive', or search a narrower view.`,
          )
        }

        const candidates = await mapGlobalSearchBatches({ model: config.model, query, batches })
        const hits = reduceGlobalSearchCandidates({
          candidates,
          units: selectedUnits,
          namespace: context.communities.namespace,
          limit,
        })
        return {
          hits,
          knowledge: {
            contributor: 'global-search',
            ...(fresh.view ? { view: fresh.view } : {}),
            generations: fresh.generations,
            coverage: fresh.coverage,
            coverageBasis: fresh.coverageBasis,
            scan,
            detail,
            available: {
              reports: availableUnits.length,
              findings: availableUnits.reduce((sum, unit) => sum + unit.findings.length, 0),
            },
            processed: {
              reports: selectedUnits.length,
              findings: selectedUnits.reduce((sum, unit) => sum + unit.findings.length, 0),
            },
            ...(scan === 'adaptive' ? { adaptive: adaptiveTrace(availableUnits, selectedUnits) } : {}),
            preflight,
            truncations: [],
          },
        }
      },
    }),
    { scan, detail: configuredDetail, limit, model: config.model.name },
  )
}

function adaptiveUnits(units: readonly SearchUnit[]): readonly SearchUnit[] {
  const roots = units.filter((unit) => !unit.parentCommunityId)
  const rootIds = new Set(roots.map((unit) => unit.communityId))
  return units.filter((unit) => !unit.parentCommunityId || rootIds.has(unit.parentCommunityId))
}

function adaptiveTrace(available: readonly SearchUnit[], selected: readonly SearchUnit[]) {
  const selectedIds = new Set(selected.map((unit) => unit.communityId))
  return {
    threshold: GLOBAL_SEARCH_ADAPTIVE_THRESHOLD,
    visited: selected.map((unit) => ({ communityId: unit.communityId, rating: GLOBAL_SEARCH_ADAPTIVE_THRESHOLD })),
    skipped: available
      .filter((unit) => !selectedIds.has(unit.communityId))
      .map((unit) => ({ communityId: unit.communityId, rating: 0 })),
  }
}
