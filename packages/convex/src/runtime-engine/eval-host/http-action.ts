import {
  httpActionGeneric,
  makeFunctionReference,
  type FunctionReference,
  type PublicHttpAction,
} from 'convex/server'
import {
  EvalHostProtocolError,
  hasEvalHostAuthorization,
  insecureTransportError,
  isSecureRequest,
  jsonResponse,
  readEvalHostRequestBytes,
  unauthorizedError,
} from '@use-crux/core/runtime/internal/eval-host'

const DEFAULT_EVAL_ACTION = '_crux/targets:handleEvalRequest'

export interface ConvexEvalHttpRequest {
  readonly url: string
  readonly method: string
  readonly headers: Array<{ name: string; value: string }>
  readonly body: ArrayBuffer
}

export interface ConvexEvalHttpResponse {
  readonly status: number
  readonly statusText: string
  readonly headers: Array<{ name: string; value: string }>
  readonly body: ArrayBuffer
}

export type ConvexEvalHttpActionReference = FunctionReference<
  'action',
  'public' | 'internal',
  { request: ConvexEvalHttpRequest },
  ConvexEvalHttpResponse
>

/** Create the default-runtime HTTP action that forwards Eval requests to Node. */
export function createConvexEvalHttpAction(
  options: {
    readonly handler?: ConvexEvalHttpActionReference
    readonly token?: string
  } = {},
): PublicHttpAction {
  const handler =
    options.handler ??
    (makeFunctionReference<
      'action',
      { request: ConvexEvalHttpRequest },
      ConvexEvalHttpResponse
    >(DEFAULT_EVAL_ACTION) as ConvexEvalHttpActionReference)

  return httpActionGeneric(async (ctx, request) => {
    if (!isSecureRequest(request)) {
      return jsonResponse({ error: insecureTransportError() }, 400)
    }
    const token = options.token ?? process.env.CRUX_EVAL_HOST_TOKEN
    if (!token) return evalHostSetupRequiredResponse()
    if (!hasEvalHostAuthorization(request, token)) {
      return jsonResponse({ error: unauthorizedError() }, 401)
    }
    let body: ArrayBuffer
    try {
      body = await readEvalHostRequestBytes(request)
    } catch (error) {
      if (!(error instanceof EvalHostProtocolError)) throw error
      return jsonResponse(
        {
          error: {
            code: error.code,
            message: error.message,
            retryable: false,
            phase: 'admission',
          },
        },
        400,
      )
    }
    const result = await ctx.runAction(handler, {
      request: {
        url: request.url,
        method: request.method,
        headers: [...request.headers.entries()].map(([name, value]) => ({
          name,
          value,
        })),
        body,
      },
    })
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers.map(({ name, value }): [string, string] => [
        name,
        value,
      ]),
    })
  })
}

function evalHostSetupRequiredResponse(): Response {
  return jsonResponse(
    {
      error: {
        code: 'EVAL_HOST_SETUP_REQUIRED',
        message:
          'Crux Eval hosting is not configured for this Convex deployment.',
        nextStep:
          'Set CRUX_EVAL_HOST_TOKEN in this Convex deployment and in the environment that runs Crux Evals.',
      },
    },
    503,
  )
}
