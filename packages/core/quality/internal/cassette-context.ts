/**
 * Cassette dispatch — connects the adapter's generation-interception slot to
 * the quality engine's per-run cassette sessions.
 *
 * The engine installs ONE process-wide dispatcher (idempotent) that resolves
 * the active {@link CassetteSession} from AsyncLocalStorage. Cell execution
 * (and scoring — judge calls replay too) runs inside `withCassetteSession`,
 * so concurrent cells and concurrent evaluation runs partition correctly,
 * and the dispatcher is inert (pass-through) outside any session scope.
 *
 * The dual-package caveat applies: this state lives in the project's core
 * instance — tooling that drives the engine must resolve `@use-crux/core` from
 * the project, never bundle its own copy.
 *
 * @internal
 * @module
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { setGenerationInterceptor } from '../../adapter/interception'
import type { CassetteSession } from './cassette'

const activeSession = new AsyncLocalStorage<CassetteSession>()

let dispatcherInstalled = false

/** Install the global interception dispatcher once (idempotent). @internal */
export function ensureCassetteDispatcher(): void {
  if (dispatcherInstalled) return
  dispatcherInstalled = true
  setGenerationInterceptor((call, execute) => {
    const session = activeSession.getStore()
    if (session === undefined) return execute()
    return session.intercept(call, execute)
  })
}

/** Run `fn` with `session` as the active cassette for all model calls inside. @internal */
export function withCassetteSession<T>(session: CassetteSession, fn: () => Promise<T>): Promise<T> {
  return activeSession.run(session, fn)
}
