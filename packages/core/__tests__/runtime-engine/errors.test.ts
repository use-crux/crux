import { describe, expect, it } from 'vitest'
import { CruxRuntimeError, RUNTIME_ERROR_CODES, createRuntimeError } from '../../runtime/engine/errors'
import { runtimeHostOnlyError } from '../../runtime/api/runtime-definition'
import { runtimeRequiredError } from '../../runtime/api/runtime-required'

describe('CruxRuntimeError', () => {
  it('renders every public error code with the six diagnostic contract elements', () => {
    for (const code of RUNTIME_ERROR_CODES) {
      const error = createRuntimeError({
        code,
        whatFailed: 'flow.waitFor() requires a Crux runtime engine.',
        why: 'Crux must store durable waiters before the current call exits.',
        whatStillWorks: 'Object-bound flow.suspend() with manual resume still works.',
        nextStep: 'Add runtime: serverless({ store: postgres(), wake: qstash() }) to crux.config.ts.',
      })

      expect(error).toBeInstanceOf(CruxRuntimeError)
      expect(error.code).toBe(code)
      expect(error.message).toContain('flow.waitFor() requires a Crux runtime engine.')
      expect(error.message).toContain('Why: Crux must store durable waiters before the current call exits.')
      expect(error.message).toContain('What still works: Object-bound flow.suspend() with manual resume still works.')
      expect(error.message).toContain(
        'Next step: Add runtime: serverless({ store: postgres(), wake: qstash() }) to crux.config.ts.',
      )
      expect(error.message).toContain(`Code: ${code}`)
      expect(error.message).toContain(`Docs: https://cruxjs.dev/docs/errors/${code}`)
    }
  })

  it('renders the standard missing-runtime template for runtime-bound APIs', () => {
    const error = runtimeRequiredError({ api: 'flow.waitFor()' })

    expect(error.code).toBe('RUNTIME_REQUIRED')
    expect(error.message).toContain('flow.waitFor() requires a Crux runtime engine.')
    expect(error.message).toContain('This flow can still use flow.suspend() with manual resume:')
    expect(error.message).toContain('await reviewFlow.signal(flowId, "approval", payload)')
    expect(error.message).toContain('runtime: serverless({ store: postgres(), wake: qstash() })')
  })

  it('renders the standard host-bound-runtime template outside the host', () => {
    const error = runtimeHostOnlyError({
      api: 'crux.flows.signal()',
      host: 'convex',
      entry: 'createConvexRuntimeHandlers({ targetExecutor }) in convex/_crux/generated.ts',
    })

    expect(error.code).toBe('RUNTIME_HOST_ONLY')
    expect(error.message).toContain('crux.flows.signal() requires the convex runtime host.')
    expect(error.message).toContain('This runtime declaration can only execute inside convex functions.')
    expect(error.message).toContain('Object-bound flow and task definitions still typecheck.')
    expect(error.message).toContain('createConvexRuntimeHandlers({ targetExecutor }) in convex/_crux/generated.ts')
  })
})
