/**
 * Framework-neutral HTTP wake request handler.
 *
 * The handler implements the public Runtime Engine status protocol for a
 * fetch-compatible `Request`/`Response` pair. It verifies the raw request
 * before decoding or writing anything, then delegates all correctness logic to
 * the kernel.
 *
 * @module
 */

import type { ResolvedRuntimeEngine } from '../api/create-runtime'
import { decodeWakeEnvelope } from '../engine/envelope'
import type { RuntimeWakeResult } from '../engine/kernel'
import type { RuntimeWakeRequestVerifier } from './verify'

/** Options for handling one HTTP wake request. */
export interface HandleWakeRequestOptions {
  /** Resolved runtime that should process the wake envelope. */
  readonly runtime: ResolvedRuntimeEngine
  /** Request verifier. Returning `false` maps to HTTP 401 and no writes. */
  readonly verify: RuntimeWakeRequestVerifier
}

/** Handle one signed runtime wake request. */
export async function handleWakeRequest(
  request: Request,
  options: HandleWakeRequestOptions,
): Promise<Response> {
  const rawBody = new Uint8Array(await request.arrayBuffer())
  const body = new TextDecoder().decode(rawBody)
  const verified = await options.verify({ request, body, rawBody })
  if (!verified) {
    return jsonResponse(
      { ok: false, outcome: 'unverified' },
      { status: 401 },
    )
  }

  const envelope = decodeWakeEnvelope(body)
  const result = await options.runtime.kernel.handleWake(envelope)
  return wakeResultResponse(result)
}

function wakeResultResponse(result: RuntimeWakeResult): Response {
  return jsonResponse(
    { ok: result.status === 200, outcome: result.outcome },
    { status: result.status },
  )
}

function jsonResponse(
  body: Record<string, unknown>,
  init?: ResponseInit,
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
}
