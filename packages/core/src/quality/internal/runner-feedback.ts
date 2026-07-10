/**
 * Feedback operations for the internal Quality runner facade.
 *
 * Tooling uses this path for human labels and review annotations without
 * growing the public `@use-crux/core/quality` root surface.
 *
 * @internal
 * @module
 */

import { join } from 'node:path'
import { createFeedbackStore, type FeedbackInput, type FeedbackRecord } from './feedback'
import type { QualityFeedbackListFilter, QualityRunnerEnv, QualityRunnerFeedback } from './runner-types'

/** Create the feedback operation group for a runner environment. */
export function createRunnerFeedback(env: QualityRunnerEnv): QualityRunnerFeedback {
  const store = createFeedbackStore({
    qualityId: env.qualityId ?? 'local',
    dir: env.dir ?? join(env.rootDir ?? process.cwd(), '.crux/quality'),
    ...(env.redact !== undefined ? { redact: env.redact } : {}),
  })

  return Object.freeze({
    add: (input: FeedbackInput) => store.record(input),
    list: async (filter?: QualityFeedbackListFilter): Promise<readonly FeedbackRecord[]> => {
      const records = await store.list()
      return Object.freeze(records.filter((record) => matchesFeedbackFilter(record, filter)))
    },
  })
}

function matchesFeedbackFilter(record: FeedbackRecord, filter: QualityFeedbackListFilter | undefined): boolean {
  if (filter === undefined) return true
  if (filter.experimentId !== undefined && record.experimentId !== filter.experimentId) return false
  if (filter.caseId !== undefined && record.caseId !== filter.caseId) return false
  if (filter.tags !== undefined && !filter.tags.every((tag) => record.tags?.includes(tag) === true)) return false
  return true
}
