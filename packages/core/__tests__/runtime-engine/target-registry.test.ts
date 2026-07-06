import { afterEach, describe, expect, it, vi } from 'vitest'
import { task } from '@use-crux/core/runtime'

describe('runtime target registry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('warns once when a durable target name is registered with a different definition', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    task('duplicate-registry-warning', { run: () => undefined })
    task('duplicate-registry-warning', { run: () => undefined })
    task('duplicate-registry-warning', { run: () => undefined })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[crux] durable target name "duplicate-registry-warning" was registered more than once with different definitions; durable target names must be unique and the last registration wins.',
    )
  })
})
