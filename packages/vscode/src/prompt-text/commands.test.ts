import { describe, expect, it, vi } from 'vitest'
import { registerPromptTextCommands } from './commands.js'

describe('registerPromptTextCommands', () => {
  it('requires an eligible active source and delegates only its primary position', async () => {
    let handler: (() => unknown) | undefined
    const preview = vi.fn()
    const showInformation = vi.fn()
    const host = {
      registerCommand(_command: string, value: () => unknown) {
        handler = value
        return { dispose() {} }
      },
      activeTarget: vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({
          source: {
            uri: 'file:///repo/writer.ts',
            sourcePath: '/repo/writer.ts',
            openEpoch: 2,
            version: 7,
            sourceHash: 'a'.repeat(64),
            documentLength: 20,
            offsetAt: vi.fn(),
            positionAt: vi.fn(),
          },
          position: { line: 3, character: 7 },
        }),
      preview,
      showInformation,
    }

    const registrations = registerPromptTextCommands(host)
    await handler?.()
    await handler?.()

    expect(registrations).toHaveLength(1)
    expect(showInformation).toHaveBeenCalledWith(
      'Open a TypeScript or JavaScript source editor before previewing PromptText.',
    )
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///repo/writer.ts' }),
      { line: 3, character: 7 },
    )
  })
})
