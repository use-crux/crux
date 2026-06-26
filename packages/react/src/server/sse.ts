/**
 * SSE handler for streaming CruxStore changes to the browser.
 *
 * Creates a Server-Sent Events endpoint that subscribes to `CruxStore.subscribe()`
 * and streams `data-crux` events to connected clients. Works with any CruxStore
 * that implements `subscribe()`.
 *
 * @module
 */

import type { CruxStore, StoreEvent } from '@use-crux/core/store'

/**
 * Options for `cruxSSEHandler`.
 */
export interface CruxSSEHandlerOptions {
  /** The CruxStore to subscribe to. Must implement `subscribe()`. */
  store: CruxStore

  /**
   * Optional key prefix filter. Only events for keys matching this prefix
   * are sent to the client. Default: `''` (all events).
   */
  prefix?: string
}

/**
 * Create an SSE endpoint handler for streaming CruxStore changes.
 *
 * Returns a function compatible with Next.js App Router `GET` handlers,
 * or any framework that expects `(request: Request) => Response`.
 *
 * The client connects via `EventSource` and receives `data-crux` events
 * matching the configured prefix filter.
 *
 * @param options - Store and optional prefix filter.
 * @returns A request handler function.
 *
 * @example
 * ```ts
 * // app/api/crux/events/route.ts (Next.js App Router)
 * import { cruxSSEHandler } from '@use-crux/react/server'
 *
 * export const GET = cruxSSEHandler({
 *   store,
 *   prefix: 'plan:',  // only plan events
 * })
 * ```
 */
export function cruxSSEHandler(options: CruxSSEHandlerOptions): (request: Request) => Response {
  const { store, prefix = '' } = options

  return (_request: Request) => {
    if (!store.subscribe) {
      return new Response('Store does not support subscribe()', {
        status: 501,
      })
    }

    const encoder = new TextEncoder()
    let unsubscribe: (() => void) | undefined

    const stream = new ReadableStream({
      start(controller) {
        // Send initial keepalive
        controller.enqueue(encoder.encode(': connected\n\n'))

        unsubscribe = store.subscribe!((event: StoreEvent) => {
          // Filter by prefix
          if (prefix && !event.key.startsWith(prefix)) return

          const entity = classifyKey(event.key)
          if (!entity) return

          const data = JSON.stringify({
            entity,
            key: event.key,
            value: event.type === 'set' ? event.value : null,
            event: event.type,
          })

          try {
            controller.enqueue(encoder.encode(`event: data-crux\ndata: ${data}\n\n`))
          } catch {
            // Stream closed — cleanup handled by cancel()
          }
        })
      },

      cancel() {
        unsubscribe?.()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }
}

/** Classify a CruxStore key into an entity type. */
function classifyKey(key: string): 'plan' | 'tasklist' | 'task' | null {
  if (key.startsWith('plan:')) return 'plan'
  if (key.startsWith('tasklist:')) return 'tasklist'
  if (key.startsWith('task:')) return 'task'
  return null
}
