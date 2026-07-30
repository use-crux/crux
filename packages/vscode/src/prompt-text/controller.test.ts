import { describe, expect, it } from 'vitest'
import { PromptTextDecorationController } from './controller.js'
import {
  DeferredPorts,
  FakePorts,
  fixture,
  settle,
  visibleEditor,
} from './controller.test-support.js'

describe('PromptTextDecorationController', () => {
  it('applies a matching fixture to the current visible editor', async () => {
    const editor = visibleEditor(4)
    const ports = new FakePorts([editor])
    ports.fixture = fixture(4)
    const controller = new PromptTextDecorationController(ports)

    controller.start()
    await settle()

    expect(ports.applied).toEqual([
      {
        editor,
        ranges: {
          heading: [
            {
              start: { line: 0, character: 18 },
              end: { line: 0, character: 23 },
            },
          ],
          link: [],
          code: [],
          emphasis: [],
          strong: [],
          list: [],
          blockquote: [],
        },
      },
    ])
  })

  it('serializes visible-editor pulls so every surface receives evidence', async () => {
    const left = visibleEditor(4, 'left', 'file:///left.ts')
    const right = visibleEditor(7, 'right', 'file:///right.ts')
    const ports = new DeferredPorts([left, right])
    const controller = new PromptTextDecorationController(ports)

    controller.start()

    expect(ports.requests.map(({ editor }) => editor)).toEqual([left])
    ports.resolve(0, fixture(4, left.uri))
    await settle()
    expect(ports.requests.map(({ editor }) => editor)).toEqual([left, right])
    ports.resolve(1, fixture(7, right.uri))
    await settle()

    expect(ports.applied.map(({ editor }) => editor)).toEqual([left, right])
  })

  it('clears synchronously when the decoration setting is disabled', async () => {
    const editor = visibleEditor(4)
    const ports = new FakePorts([editor])
    ports.fixture = fixture(4)
    const controller = new PromptTextDecorationController(ports)
    controller.start()
    await settle()

    ports.enabled = false
    controller.settingsChanged()

    expect(ports.cleared).toEqual([editor])
  })

  it('clears before an unchanged refresh so failed evidence cannot stay stale', async () => {
    const editor = visibleEditor(4)
    const ports = new FakePorts([editor])
    ports.fixture = fixture(4)
    const controller = new PromptTextDecorationController(ports)
    controller.start()
    await settle()
    ports.cleared.length = 0
    ports.fixture = undefined

    controller.start()

    expect(ports.cleared).toEqual([editor])
    await settle()
    expect(ports.applied).toHaveLength(1)
  })

  it('cancels on disable, stays pull-free while off, and repulls on enable', async () => {
    const left = visibleEditor(4, 'left')
    const right = visibleEditor(4, 'right')
    const ports = new DeferredPorts([left, right])
    const controller = new PromptTextDecorationController(ports)
    controller.start()

    ports.enabled = false
    controller.settingsChanged()

    expect(ports.requests).toHaveLength(1)
    expect(ports.requests.every(({ signal }) => signal.aborted)).toBe(true)
    expect(ports.cleared).toEqual([left, right])

    ports.visible = [visibleEditor(5, 'left'), right]
    controller.documentChanged(left.uri)
    controller.start()
    expect(ports.requests).toHaveLength(1)

    ports.enabled = true
    controller.settingsChanged()
    await settle()
    expect(ports.requests).toHaveLength(2)
    ports.resolve(1, fixture(5))
    await settle()
    expect(ports.requests).toHaveLength(3)
    ports.resolve(2, fixture(4))
    await settle()
    expect(ports.applied.map(({ editor }) => editor)).toEqual(ports.visible)
  })

  it('clears the previous editor and decorates the next visible editor on switch', async () => {
    const previous = visibleEditor(4, 'editor-1', 'file:///previous.ts')
    const next = visibleEditor(1, 'editor-2', 'file:///next.ts')
    const ports = new FakePorts([previous])
    ports.fixture = fixture(4, previous.uri)
    const controller = new PromptTextDecorationController(ports)
    controller.start()
    await settle()

    ports.visible = [next]
    ports.fixture = fixture(1, next.uri)
    controller.visibleEditorsChanged()
    await settle()

    expect(ports.cleared).toEqual([previous])
    expect(ports.applied.at(-1)?.editor).toEqual(next)
  })

  it('clears every managed editor for a closed document', async () => {
    const left = visibleEditor(4, 'left')
    const right = visibleEditor(4, 'right')
    const ports = new FakePorts([left, right])
    ports.fixture = fixture(4)
    const controller = new PromptTextDecorationController(ports)
    controller.start()
    await settle()
    ports.cleared.length = 0

    controller.documentClosed('file:///writer.ts')

    expect(ports.cleared).toEqual([left, right])
  })

  it('clears changed-document ranges and suppresses a stale response version', async () => {
    const previous = visibleEditor(4)
    const current = visibleEditor(5)
    const ports = new FakePorts([previous])
    ports.fixture = fixture(4)
    const controller = new PromptTextDecorationController(ports)
    controller.start()
    await settle()

    ports.visible = [current]
    ports.fixture = fixture(4)
    controller.documentChanged(current.uri)
    await settle()

    expect(ports.cleared).toEqual([previous])
    expect(ports.applied).toHaveLength(1)
  })

  it('discards a response whose echoed hash differs at the same version', async () => {
    const editor = visibleEditor(4)
    const ports = new FakePorts([editor])
    ports.fixture = {
      ...fixture(4),
      sourceHash: 'different-buffer-hash',
    }
    const controller = new PromptTextDecorationController(ports)

    controller.start()
    await settle()

    expect(ports.applied).toEqual([])
  })

  it('cancels superseded work and ignores its out-of-order result', async () => {
    const previous = visibleEditor(4)
    const current = visibleEditor(5)
    const ports = new DeferredPorts([previous])
    const controller = new PromptTextDecorationController(ports)
    controller.start()

    ports.visible = [current]
    controller.documentChanged(current.uri)

    expect(ports.requests[0]?.signal.aborted).toBe(true)
    await settle()
    expect(ports.requests).toHaveLength(2)

    ports.resolve(0, fixture(4))
    await settle()
    ports.resolve(1, fixture(5))
    await settle()

    expect(ports.applied).toHaveLength(1)
    expect(ports.applied[0]?.editor).toEqual(current)
  })

  it('cancels, clears, and permanently suppresses work on disposal', async () => {
    const editor = visibleEditor(4)
    const ports = new DeferredPorts([editor])
    const controller = new PromptTextDecorationController(ports)
    controller.start()

    controller.dispose()

    expect(ports.requests[0]?.signal.aborted).toBe(true)
    expect(ports.cleared).toEqual([editor])
    ports.resolve(0, fixture(4))
    await settle()
    controller.start()
    expect(ports.applied).toEqual([])
    expect(ports.requests).toHaveLength(1)
  })
})
