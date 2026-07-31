/**
 * Deterministic identity for recipes bound to a knowledge read surface.
 *
 * @module
 */

import type { RetrievalModel } from '../model'
import { stableHash } from '../../indexing/hash'
import type { NormalizedViewWhere } from '../../knowledge/view/where'
import {
  getRerankerDefinitionId,
  getRetrievalStepPublicConfig,
  getRetrieveStepConfig,
  type RetrievalStep,
} from './step'

/** Read surface that contributes to anonymous bound recipe ids. */
export type BoundRecipeReadSurface =
  | {
      readonly kind: 'knowledge-base'
      readonly knowledgeBaseId: string
      readonly namespace: string
    }
  | {
      readonly kind: 'view'
      readonly knowledgeBaseId: string
      readonly namespace: string
      readonly viewId: string
      readonly where: NormalizedViewWhere
      readonly revisionHash?: string
    }

/** Input for deriving an anonymous bound recipe identity. */
export interface BoundRetrievalRecipeIdentityInput {
  readonly surface: BoundRecipeReadSurface
  readonly steps: readonly RetrievalStep[]
  readonly model?: RetrievalModel
  readonly concurrency?: number
  readonly onSourceError?: 'fail' | 'skip-with-warning'
}

/** Stable id and behavioral fingerprint for a bound recipe. */
export interface BoundRetrievalRecipeIdentity {
  readonly id: string
  readonly fingerprint: string
}

/** Return the read surface for a knowledge-base recipe. */
export function knowledgeBaseRecipeSurface(input: {
  readonly knowledgeBaseId: string
  readonly namespace: string
}): BoundRecipeReadSurface {
  return { kind: 'knowledge-base', ...input }
}

/** Return the read surface for a view recipe. */
export function viewRecipeSurface(input: {
  readonly knowledgeBaseId: string
  readonly namespace: string
  readonly viewId: string
  readonly where: NormalizedViewWhere
  readonly revisionHash?: string
}): BoundRecipeReadSurface {
  return { kind: 'view', ...input }
}

/** Derive a process-stable anonymous recipe id from read surface and behavior. */
export function deriveBoundRetrievalRecipeIdentity(
  input: BoundRetrievalRecipeIdentityInput,
): BoundRetrievalRecipeIdentity {
  assertStableModelIdentities(input)
  const fingerprint = fingerprintRetrievalRecipeBehavior(input)
  return {
    id: `recipe_${stableHash({ surface: input.surface, fingerprint })}`,
    fingerprint,
  }
}

/** Derive a process-stable fingerprint for retrieval recipe behavior. */
export function fingerprintRetrievalRecipeBehavior(input: {
  readonly steps: readonly RetrievalStep[]
  readonly model?: RetrievalModel
  readonly concurrency?: number
  readonly onSourceError?: 'fail' | 'skip-with-warning'
}): string {
  return stableHash({
    contract: 1,
    steps: input.steps.map(stepFingerprintInput),
    ...(input.model ? { model: modelFingerprintInput(input.model) } : {}),
    concurrency: input.concurrency ?? 4,
    onSourceError: input.onSourceError ?? 'fail',
  })
}

function stepFingerprintInput(step: RetrievalStep): Record<string, unknown> {
  return {
    id: step.id,
    kind: step.kind,
    phase: step.phase,
    needsModel: step.needsModel,
    ...(step.model ? { model: modelFingerprintInput(step.model) } : {}),
    ...(getRetrieveStepConfig(step) ? { retrieve: getRetrieveStepConfig(step) } : {}),
    ...(getRerankerDefinitionId(step) ? { reranker: { engine: getRerankerDefinitionId(step) } } : {}),
    ...(getRetrievalStepPublicConfig(step) ? { config: getRetrievalStepPublicConfig(step) } : {}),
  }
}

function modelFingerprintInput(model: RetrievalModel): Record<string, unknown> {
  const value = model as RetrievalModel & { readonly name?: unknown; readonly fingerprint?: unknown }
  if (typeof value.name === 'string' && typeof value.fingerprint === 'string') {
    return { name: value.name, fingerprint: value.fingerprint }
  }
  return { kind: 'anonymous' }
}

function assertStableModelIdentities(input: BoundRetrievalRecipeIdentityInput): void {
  const models = [
    ...(input.model ? [input.model] : []),
    ...input.steps.flatMap((step) => step.model ? [step.model] : []),
  ]
  for (const model of models) {
    const value = model as RetrievalModel & { readonly name?: unknown; readonly fingerprint?: unknown }
    if (typeof value.name === 'string' && value.name.trim() && typeof value.fingerprint === 'string' && value.fingerprint.trim()) {
      continue
    }
    throw new Error('Anonymous bound recipes require model name and fingerprint. Pass a knowledgeModel() binding or an explicit recipe id.')
  }
}
