/** Adapter execution-scope boundaries for call and streaming lifetimes. */

import { openScope, runScope, type ScopeCloseOutcome } from '../../scope/kernel'
import { promptScopeSourceRef } from '../../scope/source-ref'
import type { AnyPrompt } from '../../prompt/prompt-types'
import type { AdapterExecutionStreamResult } from './run-types'

/** Run one call-shaped adapter execution to settlement. */
export function runAdapterCallScope<R>(
  prompt: AnyPrompt,
  execute: () => R | PromiseLike<R>,
): Promise<Awaited<R>> {
  return runScope(descriptorFor(prompt), {}, () => execute())
}

/**
 * Keep one adapter scope alive across stream setup, Core-owned iteration, and
 * completion. The provider/SDK raw object remains untouched.
 */
export async function runAdapterStreamScope<TRawStream>(
  prompt: AnyPrompt,
  signal: AbortSignal | undefined,
  start: () =>
    | AdapterExecutionStreamResult<TRawStream>
    | PromiseLike<AdapterExecutionStreamResult<TRawStream>>,
): Promise<AdapterExecutionStreamResult<TRawStream>> {
  const controller = openScope(descriptorFor(prompt), {})
  const seal = (outcome: ScopeCloseOutcome): void => {
    if (controller.scope.state !== 'open') return
    signal?.removeEventListener('abort', onAbort)
    controller.seal(outcome)
  }
  const onAbort = (): void => seal('cancelled')
  signal?.addEventListener('abort', onAbort, { once: true })

  const handle = await runStreamSetup(controller.run, start, () =>
    seal(signal?.aborted ? 'cancelled' : 'error'),
  )

  const completion = handle.completion.bind(handle)
  const wrappedCompletion = async () =>
    controller.run(async () => {
      try {
        const result = await completion()
        seal(signal?.aborted ? 'cancelled' : 'success')
        return result
      } catch (error) {
        seal(signal?.aborted ? 'cancelled' : 'error')
        throw error
      }
    })

  if (!('rawStream' in handle)) {
    return { ...handle, completion: wrappedCompletion }
  }

  return {
    ...handle,
    rawStream: scopedRawStream(
      handle.rawStream as AsyncIterable<unknown>,
      controller.run,
      (outcome) => seal(signal?.aborted ? 'cancelled' : outcome),
    ) as TRawStream & AsyncIterable<unknown>,
    completion: wrappedCompletion,
  }
}

async function runStreamSetup<T>(
  run: (segment: () => T | PromiseLike<T>) => T | PromiseLike<T>,
  start: () => T | PromiseLike<T>,
  onError: () => void,
): Promise<T> {
  try {
    return await run(start)
  } catch (error) {
    onError()
    throw error
  }
}

function descriptorFor(prompt: AnyPrompt) {
  const sourceRef = promptScopeSourceRef(prompt)
  return {
    kind: 'adapter-call' as const,
    name: prompt.id,
    ...(sourceRef ? { sourceRef } : {}),
  }
}

function scopedRawStream(
  source: AsyncIterable<unknown>,
  run: <T>(segment: () => T | PromiseLike<T>) => T | PromiseLike<T>,
  seal: (outcome: 'success' | 'error') => void,
): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      const iterator = await run(() => source[Symbol.asyncIterator]())
      try {
        for (;;) {
          const result = await run(() => iterator.next())
          if (result.done) {
            seal('success')
            return
          }
          yield result.value
        }
      } catch (error) {
        seal('error')
        throw error
      } finally {
        try {
          if (iterator.return) await run(() => iterator.return!())
          seal('success')
        } catch (error) {
          seal('error')
          throw error
        }
      }
    },
  }
}
