import type { PromptTextDecorationResult } from './contracts.js'
import type {
  PromptTextControllerPorts,
  PromptTextEditor,
} from './controller.js'
import type { PromptTextDecorationRanges } from './mapping.js'

export class FakePorts implements PromptTextControllerPorts {
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

export class DeferredPorts extends FakePorts {
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

export function visibleEditor(
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

export function fixture(
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

export async function settle(): Promise<void> {
  for (let index = 0; index < 6; index++) await Promise.resolve()
}
