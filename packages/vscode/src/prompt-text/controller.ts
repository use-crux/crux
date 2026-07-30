import type { PromptTextDecorationResult } from './contracts.js'
import {
  mapPromptTextDecorationRanges,
  type PromptTextDecorationRanges,
} from './mapping.js'

/** Identity and revision of one visible editor surface. */
export interface PromptTextEditor {
  readonly id: string
  readonly uri: string
  readonly openEpoch: number
  readonly version: number
  readonly sourceHash: string
}

/** Supplies the visible editor snapshot used for stale-result checks. */
export interface PromptTextWindowPort {
  /** @returns One immutable identity/revision snapshot per visible editor. */
  visibleEditors(): readonly PromptTextEditor[]
}

/** Applies or removes all PromptText roles for one editor surface. */
export interface PromptTextEditorPort {
  /**
   * @param editor - Exact editor identity and revision receiving the ranges.
   * @param ranges - Complete per-role replacement measured in UTF-16 positions.
   * @returns Nothing; replacement is synchronous at the editor boundary.
   */
  apply(editor: PromptTextEditor, ranges: PromptTextDecorationRanges): void

  /**
   * @param editor - Editor whose complete PromptText role set must be removed.
   * @returns Nothing; clearing is synchronous at the editor boundary.
   */
  clear(editor: PromptTextEditor): void
}

/** Supplies the current client-only setting read at every lifecycle boundary. */
export interface PromptTextConfigPort {
  readonly enabled: boolean
}

/** Loads exact decoration evidence through a cancellable process boundary. */
export interface PromptTextDecorationSourcePort {
  /**
   * @param editor - Exact editor revision requested by the controller.
   * @param signal - Aborted when a revision, lifecycle, or setting supersedes the request.
   * @returns Matching evidence, or `undefined` when evidence is unavailable.
   */
  request(
    editor: PromptTextEditor,
    signal: AbortSignal,
  ): Promise<PromptTextDecorationResult | undefined>
}

/** Injected editor, window, configuration, and evidence boundaries. */
export type PromptTextControllerPorts = PromptTextWindowPort &
  PromptTextEditorPort &
  PromptTextConfigPort &
  PromptTextDecorationSourcePort

/**
 * Coordinates revision-stamped PromptText decorations for visible editors.
 *
 * The controller owns request freshness and lifecycle only. Classification
 * stays outside the extension, and the injected ports keep this state machine
 * independent from VS Code globals and the inline-diagnostics controller.
 */
export class PromptTextDecorationController {
  readonly #editors = new Map<string, PromptTextEditor>()
  readonly #requests = new Map<string, AbortController>()
  readonly #applied = new Set<string>()
  // The server owns one transient compiler query, so visible surfaces drain
  // sequentially instead of superseding one another at that boundary.
  readonly #queue: PromptTextEditor[] = []
  #draining = false
  #disposed = false

  /** @param ports - Narrow boundaries for editor state, evidence, and presentation. */
  constructor(private readonly ports: PromptTextControllerPorts) {}

  /**
   * Requests decorations for the current visible editor revisions.
   *
   * Visible surfaces are pulled serially to match the server's single-query
   * coordinator. Repeated calls clear applied ranges before refreshing and
   * safely supersede pending work for the same editor.
   *
   * @returns Nothing; evidence requests continue asynchronously.
   */
  start(): void {
    if (this.#disposed) return
    this.#syncVisibleEditors(true)
  }

  /**
   * Reconciles ownership after the visible editor set changes.
   *
   * Editors leaving the snapshot are cancelled and cleared synchronously.
   *
   * @returns Nothing; new evidence requests continue asynchronously.
   */
  visibleEditorsChanged(): void {
    if (this.#disposed) return
    this.#syncVisibleEditors(false)
  }

  /**
   * Refreshes a visible document revision and retires its previous ranges.
   *
   * @param uri - Document URI reported by the editor change event.
   * @returns Nothing; stale ranges clear synchronously and refresh continues asynchronously.
   */
  documentChanged(uri: string): void {
    if (this.#disposed) return
    if (!this.ports.visibleEditors().some((editor) => editor.uri === uri))
      return
    this.#syncVisibleEditors(false)
  }

  /**
   * Clears all editor surfaces for a document before close handling returns.
   *
   * @param uri - URI of the document leaving the client session.
   * @returns Nothing; matching requests are cancelled and ranges clear synchronously.
   */
  documentClosed(uri: string): void {
    if (this.#disposed) return
    for (const [id, editor] of this.#editors) {
      if (editor.uri !== uri) continue
      this.#cancel(id)
      this.#clear(editor)
      this.#editors.delete(id)
    }
  }

  /**
   * Reconciles the current client setting.
   *
   * Disabling cancels pending work and clears every managed editor before this
   * method returns. Enabling starts fresh requests for visible revisions.
   *
   * @returns Nothing; enabled refreshes continue asynchronously.
   */
  settingsChanged(): void {
    if (this.#disposed) return
    if (this.ports.enabled) {
      this.start()
      return
    }
    for (const editor of this.#editors.values()) {
      this.#cancel(editor.id)
      this.#clear(editor)
    }
  }

  /**
   * Permanently cancels work and clears every owned editor.
   *
   * Disposal is idempotent. Every later lifecycle call is ignored.
   *
   * @returns Nothing; cancellation and clearing happen before return.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const editor of this.#editors.values()) {
      this.#cancel(editor.id)
      this.#clear(editor)
    }
    this.#editors.clear()
  }

  #syncVisibleEditors(refreshCurrent: boolean): void {
    const visible = this.ports.visibleEditors()
    const visibleIds = new Set(visible.map(({ id }) => id))
    for (const [id, previous] of this.#editors) {
      if (visibleIds.has(id)) continue
      this.#cancel(id)
      this.#clear(previous)
      this.#editors.delete(id)
    }
    for (const editor of visible) {
      const previous = this.#editors.get(editor.id)
      const changed =
        previous === undefined ||
        previous.uri !== editor.uri ||
        previous.openEpoch !== editor.openEpoch ||
        previous.version !== editor.version ||
        previous.sourceHash !== editor.sourceHash
      if (
        previous !== undefined &&
        this.#applied.has(previous.id) &&
        (changed || (refreshCurrent && this.ports.enabled))
      ) {
        this.#clear(previous)
      }
      this.#editors.set(editor.id, editor)
      if (this.ports.enabled && (changed || refreshCurrent)) {
        this.#schedule(editor)
      }
    }
  }

  #schedule(editor: PromptTextEditor): void {
    this.#cancel(editor.id)
    this.#queue.push(editor)
    void this.#drain()
  }

  async #drain(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      while (this.#queue.length > 0) {
        const editor = this.#queue.shift()
        if (
          editor === undefined ||
          this.#disposed ||
          !this.ports.enabled ||
          !sameStamp(this.#editors.get(editor.id), editor)
        )
          continue
        await this.#refresh(editor)
      }
    } finally {
      this.#draining = false
    }
  }

  async #refresh(editor: PromptTextEditor): Promise<void> {
    const request = new AbortController()
    this.#requests.set(editor.id, request)
    let resolveAbort: (() => void) | undefined
    const aborted = new Promise<undefined>((resolve) => {
      resolveAbort = () => resolve(undefined)
      request.signal.addEventListener('abort', resolveAbort, { once: true })
    })
    let result: PromptTextDecorationResult | undefined
    try {
      result = await Promise.race([
        this.ports.request(editor, request.signal),
        aborted,
      ])
    } catch {
      return
    } finally {
      if (resolveAbort !== undefined) {
        request.signal.removeEventListener('abort', resolveAbort)
      }
      if (this.#requests.get(editor.id) === request) {
        this.#requests.delete(editor.id)
      }
    }
    if (
      request.signal.aborted ||
      result === undefined ||
      this.#disposed ||
      !this.ports.enabled
    )
      return
    if (!sameStamp(result, editor)) return
    const current = this.ports
      .visibleEditors()
      .find(({ id }) => id === editor.id)
    if (current === undefined || !sameStamp(current, editor)) return
    this.ports.apply(editor, mapPromptTextDecorationRanges(result))
    this.#applied.add(editor.id)
  }

  #clear(editor: PromptTextEditor): void {
    this.ports.clear(editor)
    this.#applied.delete(editor.id)
  }

  #cancel(editorId: string): void {
    this.#requests.get(editorId)?.abort()
    this.#requests.delete(editorId)
    for (let index = this.#queue.length - 1; index >= 0; index--) {
      if (this.#queue[index]?.id === editorId) this.#queue.splice(index, 1)
    }
  }
}

function sameStamp(
  left:
    | Pick<PromptTextEditor, 'uri' | 'openEpoch' | 'version' | 'sourceHash'>
    | undefined,
  right: Pick<PromptTextEditor, 'uri' | 'openEpoch' | 'version' | 'sourceHash'>,
): boolean {
  return (
    left !== undefined &&
    left.uri === right.uri &&
    left.openEpoch === right.openEpoch &&
    left.version === right.version &&
    left.sourceHash === right.sourceHash
  )
}
