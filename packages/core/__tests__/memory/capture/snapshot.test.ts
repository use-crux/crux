import { describe, expect, it } from 'vitest'
import { memory, memoryBlock, type MemoryTurn } from '../../../src/memory'
import { config } from '../../../src/runtime/config'
import { runScope } from '../../../src/scope/internal'

describe('memory capture snapshots', () => {
  it('freezes copied containers while preserving opaque payload references', async () => {
    let releaseCapture!: () => void
    const captureCanRead = new Promise<void>((resolve) => {
      releaseCapture = resolve
    })
    let captured: MemoryTurn | undefined
    const opaqueArgs = { query: 'before' }
    const turn = {
      messages: [
        { role: 'user', content: 'before', metadata: { version: 1 } },
      ],
      toolEvents: [
        { toolCallId: 'tool-1', toolName: 'lookup', args: opaqueArgs },
      ],
      source: { promptId: 'before' },
      metadata: { version: 1 },
    } satisfies MemoryTurn
    const crux = config({
      host: {
        kind: 'memory-snapshot-test',
        invocationScope: true,
        retain() {},
      },
    })
    const mem = memory({
      id: 'snapshot',
      namespace: 'thread:1',
      blocks: [
        memoryBlock({
          id: 'capture',
          kind: 'custom',
          captureTurn: async (snapshot) => {
            await captureCanRead
            captured = snapshot
          },
        }),
      ],
    })

    try {
      await runScope({ kind: 'adapter-call' }, {}, () =>
        mem.captureTurn(turn),
      )
      turn.messages[0]!.content = 'after'
      turn.messages[0]!.metadata.version = 2
      turn.toolEvents.push({ toolCallId: 'tool-2', toolName: 'other' })
      turn.source.promptId = 'after'
      turn.metadata.version = 2
      opaqueArgs.query = 'after'

      releaseCapture()
      await mem.flush()

      expect(captured).toMatchObject({
        messages: [
          { role: 'user', content: 'before', metadata: { version: 1 } },
        ],
        toolEvents: [
          {
            toolCallId: 'tool-1',
            toolName: 'lookup',
            args: { query: 'after' },
          },
        ],
        source: { promptId: 'before' },
        metadata: { version: 1 },
      })
      expect(Object.isFrozen(captured)).toBe(true)
      expect(Object.isFrozen(captured?.messages)).toBe(true)
      expect(Object.isFrozen(captured?.messages[0]?.metadata)).toBe(true)
      expect(Object.isFrozen(captured?.toolEvents)).toBe(true)
      expect(Object.isFrozen(captured?.source)).toBe(true)
      expect(Object.isFrozen(opaqueArgs)).toBe(false)
    } finally {
      releaseCapture()
      crux.dispose()
    }
  })
})
