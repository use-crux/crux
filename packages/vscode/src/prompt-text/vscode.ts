import * as vscode from 'vscode'
import type { LanguageClient } from 'vscode-languageclient/node'
import type { PromptTextDecorationRequest } from './contracts.js'
import {
  promptTextDecorationsConfiguration,
  readPromptTextDecorationsEnabled,
} from './configuration.js'
import {
  PromptTextDecorationController,
  type PromptTextControllerPorts,
  type PromptTextEditor,
} from './controller.js'
import { PromptTextDocumentRevisions } from './document-revisions.js'
import type { PromptTextDecorationRanges } from './mapping.js'
import {
  createPromptTextDecorationRenderOptions,
  promptTextDecorationRoles,
  type PromptTextDecorationRole,
} from './types.js'
import { parsePromptTextDecorationResult } from './wire.js'

const decorationMethod = 'crux/promptText/decorations'
const refreshMethod = 'crux/promptText/refresh'

/** PromptText production decoration lifecycle bound to one language client. */
export interface PromptTextDecorations extends vscode.Disposable {
  /** Starts initial pulls after the language client has initialized. */
  start(): void
}

/**
 * Bind mapped PromptText decorations to one language-client lifetime.
 *
 * The returned host registers refresh handling immediately, but callers start
 * editor pulls only after the client itself has started.
 *
 * @param client - Active Crux language-client instance.
 * @returns A disposable host isolated from inline diagnostic decorations.
 */
export function activatePromptTextDecorations(
  client: LanguageClient,
): PromptTextDecorations {
  return new VSCodePromptTextDecorations(client)
}

class VSCodePromptTextDecorations implements PromptTextDecorations {
  readonly #revisions = new PromptTextDocumentRevisions()
  readonly #editorIds = new WeakMap<vscode.TextEditor, string>()
  readonly #editorsById = new Map<string, vscode.TextEditor>()
  readonly #types: Readonly<
    Record<PromptTextDecorationRole, vscode.TextEditorDecorationType>
  >
  readonly #controller: PromptTextDecorationController
  readonly #subscriptions: readonly vscode.Disposable[]
  #nextEditorId = 0
  #disposed = false

  constructor(private readonly client: LanguageClient) {
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
    } satisfies Record<PromptTextDecorationRole, vscode.TextEditorDecorationType>

    const ports: PromptTextControllerPorts = {
      get enabled() {
        return readPromptTextDecorationsEnabled(
          vscode.workspace.getConfiguration(),
        )
      },
      visibleEditors: () => this.#visibleEditors(),
      request: (editor, signal) => this.#request(editor, signal),
      apply: (editor, ranges) => this.#apply(editor, ranges),
      clear: (editor) => this.#clear(editor),
    }
    this.#controller = new PromptTextDecorationController(ports)
    for (const document of vscode.workspace.textDocuments) {
      if (isPromptTextDocument(document)) {
        this.#revisions.open(document.uri.toString())
      }
    }
    this.#subscriptions = [
      vscode.window.onDidChangeVisibleTextEditors(
        () => this.#controller.visibleEditorsChanged(),
      ),
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (isPromptTextDocument(document)) {
          this.#revisions.open(document.uri.toString())
        }
      }),
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (isPromptTextDocument(document)) {
          this.#controller.documentChanged(document.uri.toString())
        }
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        const uri = document.uri.toString()
        this.#revisions.close(uri)
        this.#controller.documentClosed(uri)
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(promptTextDecorationsConfiguration)) {
          this.#controller.settingsChanged()
        }
      }),
      client.onRequest(refreshMethod, (params: unknown) => {
        if (isRefreshParams(params)) this.#controller.start()
        return null
      }),
    ]
  }

  start(): void {
    if (!this.#disposed) this.#controller.start()
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#controller.dispose()
    for (const subscription of this.#subscriptions) subscription.dispose()
    for (const role of promptTextDecorationRoles) this.#types[role].dispose()
    this.#editorsById.clear()
  }

  #visibleEditors(): readonly PromptTextEditor[] {
    const visible: PromptTextEditor[] = []
    for (const editor of vscode.window.visibleTextEditors) {
      if (!isPromptTextDocument(editor.document)) continue
      const id = this.#editorId(editor)
      this.#editorsById.set(id, editor)
      visible.push({ id, ...this.#stamp(editor.document) })
    }
    return visible
  }

  async #request(
    editor: PromptTextEditor,
    signal: AbortSignal,
  ) {
    const cancellation = new vscode.CancellationTokenSource()
    const cancel = () => cancellation.cancel()
    signal.addEventListener('abort', cancel, { once: true })
    const request: PromptTextDecorationRequest = {
      protocolVersion: 1,
      uri: editor.uri,
      openEpoch: editor.openEpoch,
      version: editor.version,
      sourceHash: editor.sourceHash,
    }
    try {
      const result = await this.client.sendRequest<unknown>(
        decorationMethod,
        request,
        cancellation.token,
      )
      return parsePromptTextDecorationResult(result)
    } finally {
      signal.removeEventListener('abort', cancel)
      cancellation.dispose()
    }
  }

  #apply(editor: PromptTextEditor, ranges: PromptTextDecorationRanges): void {
    const surface = this.#editorsById.get(editor.id)
    if (surface === undefined) return
    for (const role of promptTextDecorationRoles) {
      surface.setDecorations(this.#types[role], ranges[role].map(toVSCodeRange))
    }
  }

  #clear(editor: PromptTextEditor): void {
    const surface = this.#editorsById.get(editor.id)
    if (surface === undefined) return
    for (const role of promptTextDecorationRoles) {
      surface.setDecorations(this.#types[role], [])
    }
    if (!vscode.window.visibleTextEditors.includes(surface)) {
      this.#editorsById.delete(editor.id)
    }
  }

  #stamp(document: vscode.TextDocument) {
    return this.#revisions.stamp({
      uri: document.uri.toString(),
      version: document.version,
      text: document.getText(),
    })
  }

  #editorId(editor: vscode.TextEditor): string {
    const existing = this.#editorIds.get(editor)
    if (existing !== undefined) return existing
    const id = `prompt-text-editor-${++this.#nextEditorId}`
    this.#editorIds.set(editor, id)
    return id
  }
}

function isPromptTextDocument(document: vscode.TextDocument): boolean {
  return document.uri.scheme === 'file'
    && (
      document.languageId === 'typescript'
      || document.languageId === 'typescriptreact'
      || document.languageId === 'javascript'
      || document.languageId === 'javascriptreact'
    )
}

function isRefreshParams(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && 'protocolVersion' in value
    && value.protocolVersion === 1
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
