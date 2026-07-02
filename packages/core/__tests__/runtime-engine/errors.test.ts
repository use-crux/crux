import { describe, expect, it } from 'vitest'
import {
  CruxRuntimeError,
  RUNTIME_ERROR_CODES,
  createRuntimeError,
} from '../../runtime/engine/errors'

describe('CruxRuntimeError', () => {
  it('renders every public error code with the six diagnostic contract elements', () => {
    for (const code of RUNTIME_ERROR_CODES) {
      const error = createRuntimeError({
        code,
        whatFailed: 'flow.waitFor() requires a Crux runtime engine.',
        why: 'Crux must store durable waiters before the current call exits.',
        whatStillWorks:
          'Object-bound flow.suspend() with manual resume still works.',
        nextStep:
          'Add runtime: serverless({ store: postgres(), wake: qstash() }) to crux.config.ts.',
      })

      expect(error).toBeInstanceOf(CruxRuntimeError)
      expect(error.code).toBe(code)
      expect(error.message).toContain(
        'flow.waitFor() requires a Crux runtime engine.',
      )
      expect(error.message).toContain(
        'Why: Crux must store durable waiters before the current call exits.',
      )
      expect(error.message).toContain(
        'What still works: Object-bound flow.suspend() with manual resume still works.',
      )
      expect(error.message).toContain(
        'Next step: Add runtime: serverless({ store: postgres(), wake: qstash() }) to crux.config.ts.',
      )
      expect(error.message).toContain(`Code: ${code}`)
      expect(error.message).toContain(
        `Docs: https://usecrux.dev/docs/errors/${code}`,
      )
    }
  })
})
