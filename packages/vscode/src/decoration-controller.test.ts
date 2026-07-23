import { describe, expect, it } from 'vitest'
import {
  DecorationController,
  type DecorationControllerHost,
  type DecorationEditor,
  type ScheduledDecoration,
} from './decoration-controller.js'
import type {
  DecorationDiagnostic,
  DecorationMode,
  LineDecoration,
} from './decoration-policy.js'

describe('DecorationController', () => {
  it('debounces the initial render and reads the latest Crux diagnostics', () => {
    const host = new FakeHost()
    host.editors = [{ id: 'left', uri: 'file:///writer.ts' }]
    host.setDiagnostics('file:///writer.ts', [diagnostic('first')])

    const controller = new DecorationController(host)
    controller.start()
    host.setDiagnostics('file:///writer.ts', [diagnostic('latest')])

    expect(host.delays).toEqual([100])
    expect(host.applied).toEqual([])
    host.flush()
    expect(host.applied).toEqual([{
      editorId: 'left',
      decorations: [{
        line: 2,
        severity: 'warning',
        text: '⚠ definition.rule: latest',
      }],
    }])
  })

  it('refreshes only affected visible URIs and replaces pending work per editor', () => {
    const host = new FakeHost()
    host.editors = [
      { id: 'left', uri: 'file:///left.ts' },
      { id: 'right', uri: 'file:///right.ts' },
    ]
    const controller = new DecorationController(host)
    controller.start()
    host.flush()
    host.applied = []

    controller.diagnosticsChanged(['file:///hidden.ts', 'file:///right.ts'])
    controller.diagnosticsChanged(['file:///right.ts'])

    expect(host.cancelled).toBe(1)
    host.flush()
    expect(host.applied.map(({ editorId }) => editorId)).toEqual(['right'])
  })

  it('honors auto detection, logs it once, and lets on override it', () => {
    const host = new FakeHost()
    host.editors = [{ id: 'left', uri: 'file:///writer.ts' }]
    host.activeExtensionIds = ['usernamehw.errorlens']
    const controller = new DecorationController(host)

    controller.start()
    controller.settingsChanged()

    expect(host.cleared).toEqual(['left', 'left'])
    expect(host.logs).toEqual([
      'Crux inline diagnostics disabled in auto mode because usernamehw.errorlens is active.',
    ])

    host.mode = 'on'
    controller.settingsChanged()
    host.flush()
    expect(host.applied.map(({ editorId }) => editorId)).toEqual(['left'])

    host.mode = 'off'
    controller.settingsChanged()
    expect(host.cleared.at(-1)).toBe('left')
  })

  it('cancels hidden editors and clears all managed editors on disposal', () => {
    const host = new FakeHost()
    host.editors = [
      { id: 'left', uri: 'file:///left.ts' },
      { id: 'right', uri: 'file:///right.ts' },
    ]
    const controller = new DecorationController(host)
    controller.start()

    host.editors = [{ id: 'right', uri: 'file:///right.ts' }]
    controller.visibleEditorsChanged()
    expect(host.cancelled).toBe(2)
    expect(host.cleared).toContain('left')

    controller.dispose()
    expect(host.cleared.at(-1)).toBe('right')
    expect(host.pending).toBe(0)
  })
})

class FakeHost implements DecorationControllerHost {
  editors: readonly DecorationEditor[] = []
  mode: DecorationMode = 'auto'
  maxLength = 80
  activeExtensionIds: readonly string[] = []
  applied: Array<{ editorId: string, decorations: readonly LineDecoration[] }> = []
  cleared: string[] = []
  logs: string[] = []
  delays: number[] = []
  cancelled = 0

  readonly #diagnostics = new Map<string, readonly DecorationDiagnostic[]>()
  readonly #tasks = new Set<FakeScheduledDecoration>()

  get pending(): number {
    return this.#tasks.size
  }

  visibleEditors(): readonly DecorationEditor[] {
    return this.editors
  }

  diagnostics(uri: string): readonly DecorationDiagnostic[] {
    return this.#diagnostics.get(uri) ?? []
  }

  apply(editor: DecorationEditor, decorations: readonly LineDecoration[]): void {
    this.applied.push({ editorId: editor.id, decorations })
  }

  clear(editor: DecorationEditor): void {
    this.cleared.push(editor.id)
  }

  schedule(callback: () => void, delayMs: number): ScheduledDecoration {
    this.delays.push(delayMs)
    const task = new FakeScheduledDecoration(callback, () => this.#tasks.delete(task), () => {
      this.cancelled++
    })
    this.#tasks.add(task)
    return task
  }

  log(message: string): void {
    this.logs.push(message)
  }

  setDiagnostics(uri: string, diagnostics: readonly DecorationDiagnostic[]): void {
    this.#diagnostics.set(uri, diagnostics)
  }

  flush(): void {
    for (const task of [...this.#tasks]) task.run()
  }
}

class FakeScheduledDecoration implements ScheduledDecoration {
  #active = true

  constructor(
    private readonly callback: () => void,
    private readonly remove: () => void,
    private readonly onCancel: () => void,
  ) {}

  dispose(): void {
    if (!this.#active) return
    this.#active = false
    this.remove()
    this.onCancel()
  }

  run(): void {
    if (!this.#active) return
    this.#active = false
    this.remove()
    this.callback()
  }
}

function diagnostic(message: string): DecorationDiagnostic {
  return { line: 2, severity: 2, code: 'definition.rule', message }
}
