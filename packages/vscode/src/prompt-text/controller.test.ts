import { describe, expect, it } from 'vitest'
import type { PromptTextDecorationResult } from './contracts.js'
import {
  PromptTextDecorationController,
  type PromptTextControllerPorts,
  type PromptTextEditor,
} from './controller.js'
import type { PromptTextDecorationRanges } from './mapping.js'

describe('PromptTextDecorationController', () => {
  it('applies a matching fixture to the current visible editor', async () => {
    const editor = visibleEditor(4)
    const ports = new FakePorts([editor])
    ports.fixture = fixture(4)
    const controller = new PromptTextDecorationController(ports)

    controller.start()
    await settle()

    expect(ports.applied).toEqual([{
      editor,
      ranges: {
        heading: [{
          start: { line: 0, character: 18 },
          end: { line: 0, character: 23 },
        }],
        link: [],
        code: [],
        emphasis: [],
        strong: [],
        list: [],
        blockquote: [],
      },
    }])
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

    expect(ports.requests).toHaveLength(2)
    expect(ports.requests[0]?.signal.aborted).toBe(true)

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

class FakePorts implements PromptTextControllerPorts {
  fixture: PromptTextDecorationResult | undefined
  enabled = true
  visible: readonly PromptTextEditor[]
  readonly applied: Array<{
    readonly editor: PromptTextEditor
    readonly ranges: PromptTextDecorationRanges
  }> = []
  readonly cleared: PromptTextEditor[] = []

  constructor(visible: readonly PromptTextEditor[]) {
    this.visible = visible
  }

  visibleEditors(): readonly PromptTextEditor[] {
    return this.visible
  }

  async request(
    _editor: PromptTextEditor,
    _signal: AbortSignal,
  ): Promise<PromptTextDecorationResult | undefined> {
    return this.fixture
  }

  apply(editor: PromptTextEditor, ranges: PromptTextDecorationRanges): void {
    this.applied.push({ editor, ranges })
  }

  clear(editor: PromptTextEditor): void {
    this.cleared.push(editor)
  }
}

class DeferredPorts extends FakePorts {
  readonly requests: Array<{
    readonly editor: PromptTextEditor
    readonly signal: AbortSignal
    readonly resolve: (fixture: PromptTextDecorationResult | undefined) => void
  }> = []

  override request(
    editor: PromptTextEditor,
    signal: AbortSignal,
  ): Promise<PromptTextDecorationResult | undefined> {
    return new Promise((resolve) => {
      this.requests.push({ editor, signal, resolve })
    })
  }

  resolve(index: number, value: PromptTextDecorationResult | undefined): void {
    this.requests[index]?.resolve(value)
  }
}

function visibleEditor(
  version: number,
  id = 'editor-1',
  uri = 'file:///writer.ts',
): PromptTextEditor {
  return {
    id,
    uri,
    openEpoch: 2,
    version,
    sourceHash: `hash-${version}`,
  }
}

function fixture(
  version: number,
  uri = 'file:///writer.ts',
): PromptTextDecorationResult {
  return {
    protocolVersion: 1,
    uri,
    openEpoch: 2,
    version,
    sourceHash: `hash-${version}`,
    decorations: [{
      role: 'heading',
      range: {
        start: { line: 0, character: 18 },
        end: { line: 0, character: 23 },
      },
    }],
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
