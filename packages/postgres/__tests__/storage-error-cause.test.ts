import { StorageError } from '@use-crux/core/storage'
import { describe, expect, it } from 'vitest'
import { backendError } from '../src/storage/sql'

describe('PostgreSQL storage backend errors', () => {
  it('preserves safe StorageError details and the exact backend cause', () => {
    const causes: readonly unknown[] = [new Error('database connection contains unsafe details'), 'raw backend failure']

    for (const cause of causes) {
      try {
        backendError('read', cause)
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError)
        expect(error).toMatchObject({
          code: 'backend_error',
          message: 'PostgreSQL storage read failed.',
        })
        expect((error as StorageError).cause).toBe(cause)
        continue
      }

      throw new Error('backendError did not throw')
    }
  })
})
