import * as vscode from 'vscode'
import {
  DecorationController,
  type DecorationControllerHost,
  type DecorationEditor,
  type ScheduledDecoration,
} from './decoration-controller.js'
import {
  DecorationTypeRegistry,
  handleDecorationConfigurationChange,
} from './decoration-types.js'
import {
  decorationSeverities,
  inlineDiagnosticsExtensionIds,
  type DecorationDiagnostic,
  type DecorationMode,
  type DecorationSeverity,
  type LineDecoration,
} from './decoration-policy.js'

type DecorationTypes = Readonly<Record<DecorationSeverity, vscode.TextEditorDecorationType>>

/** Activates client-only inline diagnostic decorations for visible editors. */
export function activateDecorations(output: vscode.OutputChannel): vscode.Disposable {
  const configuration = vscode.workspace.getConfiguration('crux')
  const types = new DecorationTypeRegistry(
    createDecorationTypes,
    configuration.get<number>('decorations.opacity', 0.65),
  )
  const host = new VSCodeDecorationHost(output, types)
  const controller = new DecorationController(host)
  const events = [
    vscode.languages.onDidChangeDiagnostics(({ uris }) => {
      controller.diagnosticsChanged(uris.map((uri) => uri.toString()))
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => controller.visibleEditorsChanged()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      handleDecorationConfigurationChange(
        (section) => event.affectsConfiguration(section),
        types,
        host.opacity,
        () => controller.settingsChanged(),
      )
    }),
    vscode.extensions.onDidChange(() => controller.extensionsChanged()),
  ]
  controller.start()
  return vscode.Disposable.from(controller, types, ...events)
}

class VSCodeDecorationHost implements DecorationControllerHost {
  readonly #editorIds = new WeakMap<vscode.TextEditor, string>()
  #nextEditorId = 1

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly types: DecorationTypeRegistry<vscode.TextEditorDecorationType>,
  ) {}

  get mode(): DecorationMode {
    return vscode.workspace.getConfiguration('crux').get<DecorationMode>('decorations.mode', 'auto')
  }

  get maxLength(): number {
    return vscode.workspace.getConfiguration('crux').get<number>('decorations.maxLength', 80)
  }

  get opacity(): number {
    return vscode.workspace.getConfiguration('crux').get<number>('decorations.opacity', 0.65)
  }

  get activeExtensionIds(): readonly string[] {
    return inlineDiagnosticsExtensionIds.filter((id) => vscode.extensions.getExtension(id)?.isActive)
  }

  visibleEditors(): readonly DecorationEditor[] {
    return vscode.window.visibleTextEditors.map((editor) => ({
      id: this.#id(editor),
      uri: editor.document.uri.toString(),
    }))
  }

  diagnostics(uri: string): readonly DecorationDiagnostic[] {
    return vscode.languages.getDiagnostics(vscode.Uri.parse(uri))
      .filter((diagnostic) => diagnostic.source === 'crux')
      .map((diagnostic) => ({
        line: diagnostic.range.start.line,
        severity: diagnostic.severity + 1,
        code: diagnosticCode(diagnostic.code),
        message: diagnostic.message,
      }))
  }

  apply(editor: DecorationEditor, decorations: readonly LineDecoration[]): void {
    const textEditor = this.#findEditor(editor.id)
    if (textEditor === undefined) return
    const options = emptyDecorationOptions()
    for (const decoration of decorations) {
      if (decoration.line < 0 || decoration.line >= textEditor.document.lineCount) continue
      const end = textEditor.document.lineAt(decoration.line).range.end
      options[decoration.severity].push({
        range: new vscode.Range(end, end),
        renderOptions: { after: { contentText: decoration.text } },
      })
    }
    for (const severity of decorationSeverities) {
      textEditor.setDecorations(this.types.current[severity], options[severity])
    }
  }

  clear(editor: DecorationEditor): void {
    const textEditor = this.#findEditor(editor.id)
    if (textEditor === undefined) return
    for (const severity of decorationSeverities) {
      textEditor.setDecorations(this.types.current[severity], [])
    }
  }

  schedule(callback: () => void, delayMs: number): ScheduledDecoration {
    const timeout = setTimeout(callback, delayMs)
    return new vscode.Disposable(() => clearTimeout(timeout))
  }

  log(message: string): void {
    this.output.appendLine(message)
  }

  #id(editor: vscode.TextEditor): string {
    const existing = this.#editorIds.get(editor)
    if (existing !== undefined) return existing
    const id = `editor-${this.#nextEditorId++}`
    this.#editorIds.set(editor, id)
    return id
  }

  #findEditor(id: string): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((editor) => this.#id(editor) === id)
  }
}

function createDecorationTypes(opacity: number): DecorationTypes {
  return {
    error: createDecorationType('editorError.foreground', opacity),
    warning: createDecorationType('editorWarning.foreground', opacity),
    information: createDecorationType('editorInfo.foreground', opacity),
    hint: createDecorationType('editorHint.foreground', opacity),
  }
}

function createDecorationType(color: string, opacity: number): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    opacity: String(opacity),
    after: {
      color: new vscode.ThemeColor(color),
      fontStyle: 'italic',
      margin: '0 0 0 2em',
    },
  })
}

function emptyDecorationOptions(): Record<DecorationSeverity, vscode.DecorationOptions[]> {
  return { error: [], warning: [], information: [], hint: [] }
}

function diagnosticCode(code: vscode.Diagnostic['code']): string | number {
  if (typeof code === 'string' || typeof code === 'number') return code
  return code?.value ?? 'crux'
}
