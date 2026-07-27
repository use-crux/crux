import type { Utf16Position } from './contracts.js'
import type { PromptTextPreviewSource } from './preview/types.js'

/** User-facing command that pulls a safe static PromptText preview. */
export const promptTextPreviewStaticCommand = 'crux.promptText.previewStatic'

interface PromptTextCommandRegistration {
  dispose(): void
}

/** Exact active source snapshot plus its primary active UTF-16 position. */
export interface PromptTextPreviewCommandTarget {
  readonly source: PromptTextPreviewSource
  readonly position: Utf16Position
}

/** Editor operations used by the client-owned static-preview command. */
export interface PromptTextPreviewCommandHost {
  registerCommand(
    command: string,
    handler: () => unknown,
  ): PromptTextCommandRegistration
  activeTarget(): PromptTextPreviewCommandTarget | undefined
  preview(
    source: PromptTextPreviewSource,
    position: Utf16Position,
  ): Promise<void>
  showInformation(message: string): void
}

/**
 * Register static preview independently from server-owned execute commands.
 *
 * Only one active eligible editor and its primary active position cross this
 * boundary; additional selections never affect template choice.
 */
export function registerPromptTextCommands(
  host: PromptTextPreviewCommandHost,
): readonly PromptTextCommandRegistration[] {
  return [
    host.registerCommand(promptTextPreviewStaticCommand, async () => {
      const target = host.activeTarget()
      if (target === undefined) {
        host.showInformation(
          'Open a TypeScript or JavaScript source editor before previewing PromptText.',
        )
        return
      }
      await host.preview(target.source, target.position)
    }),
  ]
}
