/**
 * Auxiliary Worker for Phase 7 cross-isolate resume proof.
 *
 * Configured as a separate named Worker in `vitest.observability.config.ts`
 * (`miniflare.workers`), reachable only through the primary fixture worker's
 * `RESUMER` service binding. It has its own module scope, its own
 * `setObservabilityTransport()` call, and its own `delivered` array —
 * nothing here is imported by, or shares a global with, `fixtures/worker.ts`.
 * The only channel between the two is the JSON carrier in the HTTP request
 * body and this worker's own HTTP response, exactly the boundary a real
 * distributed resume (a different process, region, or Worker entirely)
 * would have to cross.
 */

/// <reference types="@cloudflare/workers-types" />

import {
  acceptedDeliveryReceipt,
  observe,
  setObservabilityTransport,
  type CruxDeliveryReceipt,
  type CruxGraphRecord,
  type CruxObservabilityTransport,
  type CruxPropagationCarrier,
} from '@use-crux/core/observability'

const delivered: CruxGraphRecord[] = []
let transportInstalled = false

function ensureTransportInstalled(): void {
  // Keep fixture mutation request-scoped, matching normal Worker setup.
  if (transportInstalled) return
  transportInstalled = true
  const transport: CruxObservabilityTransport = {
    async send(records): Promise<CruxDeliveryReceipt> {
      delivered.push(...records)
      return acceptedDeliveryReceipt(records)
    },
  }
  setObservabilityTransport(transport, { scheduledDelayMs: 0 })
}

async function route(request: Request): Promise<Response> {
  ensureTransportInstalled()
  const url = new URL(request.url)
  if (url.pathname !== '/resume') return new Response('not found', { status: 404 })

  const body = (await request.json()) as { carrier: CruxPropagationCarrier }
  try {
    const run = observe.resumeRun(body.carrier, { reason: 'resumed in a separate service-bound Worker' })
    run.end()
    await observe.flush({ timeoutMs: 5000 })

    const resumeRecord = delivered.find((record) => record.type === 'run:resume')
    return Response.json({
      runId: run.runId,
      segmentId: run.segmentId,
      resumeRecordSegmentId: (resumeRecord as { segmentId?: string } | undefined)?.segmentId,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Invalid Crux continuation' },
      { status: 400 },
    )
  }
}

export default {
  fetch: (request: Request) => route(request),
} satisfies ExportedHandler
