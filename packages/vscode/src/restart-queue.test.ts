import { describe, expect, it, vi } from 'vitest'
import { RestartQueue } from './restart-queue.js'

describe('RestartQueue', () => {
  it('runs a later restart after an earlier restart rejects', async () => {
    const queue = new RestartQueue()
    const restart = vi.fn()
      .mockRejectedValueOnce(new Error('first start failed'))
      .mockResolvedValueOnce(undefined)

    await expect(queue.enqueue(restart)).rejects.toThrow('first start failed')
    await expect(queue.enqueue(restart)).resolves.toBeUndefined()
    expect(restart).toHaveBeenCalledTimes(2)
  })
})
