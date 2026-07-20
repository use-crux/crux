/**
 * Regression fixture: proves the Core observability and Cloudflare import
 * graphs are startup-safe in a genuinely natively-loaded Worker.
 *
 * Unlike `fixtures/worker.ts` (loaded through the pool's own Vite pipeline
 * for the `wrangler.configPath` worker, which defers module evaluation and
 * can mask a module-scope violation) this file is registered as a raw
 * `miniflare.workers` entry, exactly like `resumer-worker.ts`. workerd
 * rejects any Worker whose top-level module evaluation performs I/O
 * (including random-value generation) before the first request handler
 * runs. Importing these two entry points at module scope and doing nothing
 * else is the whole test: if `observe.ts`'s module-level delivery-engine
 * singleton ever again calls into ID/random generation eagerly (as it did
 * before the `ensureSourceId` fix), this Worker fails to start at all.
 */

/// <reference types="@cloudflare/workers-types" />

import '@use-crux/core/observability'
import '../../../src'

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.pathname !== '/ping') return new Response('not found', { status: 404 })
  return Response.json({ ok: true })
}

export default {
  fetch: (request: Request) => route(request),
} satisfies ExportedHandler
