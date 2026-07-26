import * as vscode from 'vscode'
import type { PromptTextDecorationFixture } from '../../src/prompt-text/contracts.js'
import { mapPromptTextDecorationRanges } from '../../src/prompt-text/mapping.js'
import {
  createPromptTextDecorationRenderOptions,
  promptTextDecorationRoles,
  type PromptTextDecorationRole,
} from '../../src/prompt-text/types.js'

/**
 * Owns real VS Code decoration types for one extension-host smoke surface.
 *
 * `updateCount` counts `setDecorations` replacement calls. It is an API-level
 * repaint proxy, not a claim about VS Code's internal compositor.
 */
export class ExtensionHostDecorationSurface {
  readonly #types: Readonly<
    Record<PromptTextDecorationRole, vscode.TextEditorDecorationType>
  >
  #updateCount = 0

  constructor() {
    const options = createPromptTextDecorationRenderOptions(
      (id) => new vscode.ThemeColor(id),
    )
    this.#types = {
      heading: vscode.window.createTextEditorDecorationType(options.heading),
      link: vscode.window.createTextEditorDecorationType(options.link),
      code: vscode.window.createTextEditorDecorationType(options.code),
      emphasis: vscode.window.createTextEditorDecorationType(options.emphasis),
      strong: vscode.window.createTextEditorDecorationType(options.strong),
      list: vscode.window.createTextEditorDecorationType(options.list),
      blockquote: vscode.window.createTextEditorDecorationType(options.blockquote),
    }
  }

  /** Number of role replacement calls made by this surface. */
  get updateCount(): number {
    return this.#updateCount
  }

  /** Replaces every role from one fixture payload. */
  apply(
    editor: vscode.TextEditor,
    fixture: PromptTextDecorationFixture,
  ): void {
    const mapped = mapPromptTextDecorationRanges(fixture)
    for (const role of promptTextDecorationRoles) {
      editor.setDecorations(this.#types[role], mapped[role].map(toVSCodeRange))
      this.#updateCount++
    }
  }

  /** Removes every role synchronously through empty replacements. */
  clear(editor: vscode.TextEditor): void {
    for (const role of promptTextDecorationRoles) {
      editor.setDecorations(this.#types[role], [])
      this.#updateCount++
    }
  }

  /** Releases all real `TextEditorDecorationType` handles. */
  dispose(): void {
    for (const role of promptTextDecorationRoles) {
      this.#types[role].dispose()
    }
  }
}

function toVSCodeRange(range: {
  readonly start: { readonly line: number, readonly character: number }
  readonly end: { readonly line: number, readonly character: number }
}): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  )
}
