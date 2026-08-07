/**
 * Public configuration for connected knowledge communities.
 *
 * @module
 */

import { stableHash } from '../../indexing/hash'
import type { KnowledgeModel } from '../model'
import {
  COMMUNITY_INPUT_BUDGET,
  COMMUNITY_PARENT_BUDGET_MULTIPLE,
  PARENT_INPUT_BUDGET,
} from './cluster'
import { ASSERTION_MEMBERSHIP_POLICY_VERSION, ASSERTION_REPORT_PROMPT_VERSION } from './assertion-policy'

/** Internal community strategy version. */
export const COMMUNITY_STRATEGY_VERSION = 2

/** Configuration returned by {@link communities}. */
export interface CommunitiesConfig {
  /** Stable configured id for this communities strategy. */
  readonly id: string
  /** Model used to generate community reports. */
  readonly model: KnowledgeModel
  /** Fingerprint covering report strategy and model identity. */
  readonly strategyFingerprint: string
}

/** Configuration accepted by {@link communities}. */
export interface CommunitiesFactoryConfig {
  /** Named model used to generate community reports. */
  readonly model: KnowledgeModel
  /** Stable id for this communities configuration. */
  readonly id?: string
}

/**
 * Configure Connected Knowledge community reports.
 *
 * @param config - Named model binding plus optional stable id.
 * @returns A frozen communities configuration for `knowledgeBase()`.
 *
 * @example
 * ```ts
 * const docs = knowledgeBase({
 *   id: 'docs',
 *   storage,
 *   communities: communities({ model }),
 * })
 * ```
 */
export function communities(config: CommunitiesFactoryConfig): CommunitiesConfig {
  validateModel(config?.model)
  const id = config.id ?? 'communities'
  if (!id.trim()) throw new Error('Communities id must be non-empty.')
  const model = config.model
  return Object.freeze({
    id,
    model,
    strategyFingerprint: stableHash({
      version: COMMUNITY_STRATEGY_VERSION,
      model: { name: model.name, fingerprint: model.fingerprint },
      budgets: {
        leaf: COMMUNITY_INPUT_BUDGET,
        parent: PARENT_INPUT_BUDGET,
        parentMultiple: COMMUNITY_PARENT_BUDGET_MULTIPLE,
      },
      assertionMembershipPolicy: ASSERTION_MEMBERSHIP_POLICY_VERSION,
      reportPrompt: ASSERTION_REPORT_PROMPT_VERSION,
    }),
  })
}

function validateModel(value: unknown): asserts value is KnowledgeModel {
  if (!isRecord(value)) throw new Error('Communities require a knowledge model.')
  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Communities model name must be non-empty.')
  }
  if (typeof value.fingerprint !== 'string' || !value.fingerprint.trim()) {
    throw new Error('Communities model fingerprint must be non-empty.')
  }
  if (typeof value.generateText !== 'function' || typeof value.generateObject !== 'function') {
    throw new Error('Communities model must provide retrieval methods.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
