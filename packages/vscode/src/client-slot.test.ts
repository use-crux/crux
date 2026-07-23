import { describe, expect, it, vi } from 'vitest'
import { ClientSlot } from './client-slot.js'
import { RestartQueue } from './restart-queue.js'

describe('ClientSlot', () => {
  it('lets the next queued restart start after client startup fails', async () => {
    const slot = new ClientSlot()
    const queue = new RestartQueue()
    const failed = {
      start: vi.fn().mockRejectedValue(new Error('start failed')),
      stop: vi.fn().mockRejectedValue(new Error('cannot stop StartFailed client')),
    }
    const recovered = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    }

    await expect(queue.enqueue(() => slot.start(failed))).rejects.toThrow('start failed')
    await expect(queue.enqueue(async () => {
      await slot.stop()
      await slot.start(recovered)
    })).resolves.toBeUndefined()

    expect(failed.stop).not.toHaveBeenCalled()
    expect(recovered.start).toHaveBeenCalledOnce()
  })
})
