import {
  buildLineDecorations,
  filterAffectedVisibleUris,
  resolveDecorationMode,
  type DecorationDiagnostic,
  type DecorationMode,
  type LineDecoration,
} from './decoration-policy.js'

const decorationDebounceMs = 100

/** A visible editor identity. Multiple editors may show the same URI. */
export interface DecorationEditor {
  readonly id: string
  readonly uri: string
}

/** A cancellable task returned by the host scheduler. */
export interface ScheduledDecoration {
  dispose(): void
}

/** Client host operations used by the editor-independent decoration controller. */
export interface DecorationControllerHost {
  readonly mode: DecorationMode
  readonly maxLength: number
  readonly activeExtensionIds: readonly string[]
  visibleEditors(): readonly DecorationEditor[]
  diagnostics(uri: string): readonly DecorationDiagnostic[]
  apply(editor: DecorationEditor, decorations: readonly LineDecoration[]): void
  clear(editor: DecorationEditor): void
  schedule(callback: () => void, delayMs: number): ScheduledDecoration
  log(message: string): void
}

/**
 * Coordinates client-only inline diagnostics for visible editors.
 *
 * The host supplies editor and diagnostics data, keeping debounce and mode
 * behavior independently testable from the VS Code extension process.
 */
export class DecorationController {
  readonly #pending = new Map<string, ScheduledDecoration>()
  readonly #editors = new Map<string, DecorationEditor>()
  #detectedExtensionId: string | undefined
  #disposed = false

  constructor(private readonly host: DecorationControllerHost) {}

  /** Starts decoration rendering for the current visible editors. */
  start(): void {
    this.#refreshVisibleEditors()
  }

  /** Refreshes only visible editors whose diagnostics changed. */
  diagnosticsChanged(affectedUris: readonly string[]): void {
    if (this.#disposed) return
    const editors = this.#syncVisibleEditors()
    const affected = new Set(filterAffectedVisibleUris(
      affectedUris,
      editors.map(({ uri }) => uri),
    ))
    const resolution = this.#resolveMode()
    if (!resolution.enabled) {
      this.#clearEditors(editors)
      return
    }
    for (const editor of editors) {
      if (affected.has(editor.uri)) this.#schedule(editor)
    }
  }

  /** Reconciles decorations after the visible editor set changes. */
  visibleEditorsChanged(): void {
    this.#refreshVisibleEditors()
  }

  /** Re-evaluates extension-only decoration settings. */
  settingsChanged(): void {
    this.#refreshVisibleEditors()
  }

  /** Re-evaluates auto mode after installed extension state changes. */
  extensionsChanged(): void {
    this.#refreshVisibleEditors()
  }

  /** Cancels pending work and clears every editor managed by this controller. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const pending of this.#pending.values()) pending.dispose()
    this.#pending.clear()
    this.#clearEditors([...this.#editors.values()])
    this.#editors.clear()
  }

  #refreshVisibleEditors(): void {
    if (this.#disposed) return
    const editors = this.#syncVisibleEditors()
    const resolution = this.#resolveMode()
    if (!resolution.enabled) {
      this.#clearEditors(editors)
      return
    }
    for (const editor of editors) this.#schedule(editor)
  }

  #syncVisibleEditors(): readonly DecorationEditor[] {
    const visible = this.host.visibleEditors()
    const visibleIds = new Set(visible.map(({ id }) => id))
    for (const [id, editor] of this.#editors) {
      if (visibleIds.has(id)) continue
      this.#cancel(id)
      this.host.clear(editor)
      this.#editors.delete(id)
    }
    for (const editor of visible) this.#editors.set(editor.id, editor)
    return visible
  }

  #resolveMode(): ReturnType<typeof resolveDecorationMode> {
    const resolution = resolveDecorationMode(this.host.mode, this.host.activeExtensionIds)
    if (resolution.detectedExtensionId !== undefined
      && resolution.detectedExtensionId !== this.#detectedExtensionId) {
      this.host.log(
        `Crux inline diagnostics disabled in auto mode because ${resolution.detectedExtensionId} is active.`,
      )
    }
    this.#detectedExtensionId = resolution.detectedExtensionId
    return resolution
  }

  #schedule(editor: DecorationEditor): void {
    this.#cancel(editor.id)
    let scheduled: ScheduledDecoration
    scheduled = this.host.schedule(() => {
      if (this.#disposed || this.#pending.get(editor.id) !== scheduled) return
      this.#pending.delete(editor.id)
      const resolution = this.#resolveMode()
      if (!resolution.enabled) {
        this.host.clear(editor)
        return
      }
      this.host.apply(
        editor,
        buildLineDecorations(this.host.diagnostics(editor.uri), this.host.maxLength),
      )
    }, decorationDebounceMs)
    this.#pending.set(editor.id, scheduled)
  }

  #clearEditors(editors: readonly DecorationEditor[]): void {
    for (const editor of editors) {
      this.#cancel(editor.id)
      this.host.clear(editor)
    }
  }

  #cancel(editorId: string): void {
    this.#pending.get(editorId)?.dispose()
    this.#pending.delete(editorId)
  }
}
