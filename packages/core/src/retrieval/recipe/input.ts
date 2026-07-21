/** Media-safe retrieval recipe input preparation. @module */

import { prepareRecipeRetrievalInput } from '../query-input'
import { normalizeRetrieveRequest, retrieveOptions } from '../request'
import type { RetrieveInput, RetrieveOptions, RetrieveRequest } from '../request'
import type { RetrievalStep } from './step'

/** Canonical runtime and trace representations of one recipe input. */
export interface PreparedRecipeRequest {
  /** Original canonical request, retained only for the retrieve step. */
  readonly request: RetrieveRequest
  /** Privacy-safe text or modality marker used by traces and planned queries. */
  readonly label: string
  /** Whether the original request contains media. */
  readonly media: boolean
  /** Byte-free request exposed to traces and non-retrieve steps. */
  readonly safeRequest: RetrieveRequest
}

/** Normalize a public recipe input and derive its byte-free execution label. */
export async function prepareRecipeRequest(
  input: RetrieveInput,
  options: RetrieveOptions,
): Promise<PreparedRecipeRequest> {
  const request = normalizeRetrieveRequest(input, options)
  const prepared = await prepareRecipeRetrievalInput(request)
  return {
    request,
    label: prepared.label,
    media: prepared.media,
    safeRequest: { ...retrieveOptions(request), query: prepared.label },
  }
}

/** Reject query-planning steps that require text when a recipe receives media. */
export function assertRecipeStepSupportsInput(step: RetrievalStep, media: boolean): void {
  if (!media || step.kind === 'retrieve' || step.phase.in !== 'queries') return
  throw new TypeError(
    `Retrieval recipe step "${step.id}" cannot rewrite or fan out a media query; place retrieve() first or use a text query.`,
  )
}
