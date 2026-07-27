import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { promptTextPreviewStaticCommand } from '../../src/prompt-text/commands.js'
import {
  activatePromptTextPreviews,
  type PromptTextPreviews,
} from '../../src/prompt-text/preview/vscode.js'
import { PromptTextPreviewLanguageTransitions } from '../../src/prompt-text/preview/language-transition.js'

const previewScheme = 'crux-prompt-preview'

/** Exercise the production static-preview adapter in VS Code 1.90.2. */
export async function runStaticPreviewHost(): Promise<void> {
  await verifyLanguageTransition()
  const directory = await mkdtemp(join(tmpdir(), 'crux-static-preview-'))
  const sourcePath = join(directory, 'writer.ts')
  const sourceText = 'const prompt = md`# Hello`;\n'
  const previewText = '# Hello\n'
  await writeFile(sourcePath, sourceText, 'utf8')
  const previews = activatePromptTextPreviews()
  const client = previewClient(previewText)
  try {
    previews.connect(client as never)
    const source = await vscode.workspace.openTextDocument(sourcePath)
    await vscode.window.showTextDocument(source, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    })

    await vscode.commands.executeCommand(promptTextPreviewStaticCommand)
    const first = previewDocuments()
    assert.equal(
      first.length,
      1,
      'The command did not open exactly one preview.',
    )
    assert.equal(first[0]?.getText(), previewText)
    assert.equal(first[0]?.languageId, 'markdown')
    assert.equal(first[0]?.uri.scheme, previewScheme)
    assert.equal(first[0]?.uri.path, '/Static preview — writer.ts L1 — 1.md')
    assert.equal(first[0]?.uri.query, 'slot=1')
    assert.equal(first[0]?.uri.authority, '')
    assert.equal(first[0]?.uri.fragment, '')
    assert.equal(
      vscode.window.activeTextEditor?.document.uri.toString(),
      first[0]?.uri.toString(),
      'The preview was not focused.',
    )
    const lenses = await vscode.commands.executeCommand<
      readonly vscode.CodeLens[]
    >('vscode.executeCodeLensProvider', first[0]?.uri)
    assert.equal(lenses?.length, 1)
    assert.equal(lenses?.[0]?.range.isEmpty, true)
    assert.match(lenses?.[0]?.command?.title ?? '', /syntax-exact/)
    assert.doesNotMatch(first[0]?.getText() ?? '', /syntax-exact/)

    await vscode.window.showTextDocument(source, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    })
    await vscode.commands.executeCommand(promptTextPreviewStaticCommand)
    const second = previewDocuments()
    assert.equal(
      second.length,
      1,
      'Repeated preview allocated another resource.',
    )
    assert.equal(second[0]?.uri.toString(), first[0]?.uri.toString())

    await vscode.window.showTextDocument(first[0]!, {
      viewColumn: vscode.ViewColumn.Three,
      preview: false,
    })
    assert.equal(
      vscode.window.visibleTextEditors.filter(
        (editor) => editor.document.uri.toString() === first[0]?.uri.toString(),
      ).length,
      2,
      'Split editors did not share the preview resource.',
    )
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    assert.equal(
      previewDocuments().length,
      1,
      'Closing one split disposed the shared preview document.',
    )

    const sourceEditor = await vscode.window.showTextDocument(source, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
    })
    client.setText('# Edited\n')
    assert.equal(
      await sourceEditor.edit((builder) => {
        builder.insert(new vscode.Position(0, 0), ' ')
      }),
      true,
    )
    await eventually(
      () => first[0]?.getText() === '# Edited\n',
      'The 150 ms edit refresh did not republish the tracked range.',
    )
    assert.equal(await source.save(), true)

    previews.disconnect()
    await eventually(
      () => first[0]?.getText() === '',
      'Disconnect did not clear the retained preview bytes.',
    )
    client.setText('# Reconnected\n')
    previews.connect(client as never)
    await eventually(
      () => first[0]?.getText() === '# Reconnected\n',
      'Reconnect did not repull the still-open exact range.',
    )

    const renamed = vscode.Uri.file(join(directory, 'renamed.ts'))
    const rename = new vscode.WorkspaceEdit()
    rename.renameFile(source.uri, renamed)
    assert.equal(await vscode.workspace.applyEdit(rename), true)
    await eventually(
      () => first[0]?.getText() === '',
      'Source rename followed the old slot instead of detaching it.',
    )
    await closeDocumentTabs(renamed)

    await vscode.window.showTextDocument(first[0]!, {
      viewColumn: vscode.ViewColumn.Two,
      preview: false,
    })
    await closeDocumentTabs(first[0]!.uri)
    await eventually(
      () =>
        vscode.window.visibleTextEditors.every(
          (editor) => editor.document.uri.scheme !== previewScheme,
        ),
      'Closing the final virtual editor left a preview editor visible.',
    )
  } finally {
    previews.dispose()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors')
    await rm(directory, { recursive: true, force: true })
  }
}

async function verifyLanguageTransition(): Promise<void> {
  const scheme = 'crux-prompt-transition-test'
  const uri = vscode.Uri.from({ scheme, path: '/preview' })
  const identity = uri.toString()
  const transitions = new PromptTextPreviewLanguageTransitions()
  const closes: Array<'ignore' | 'dispose'> = []
  const opens: boolean[] = []
  const subscriptions = [
    vscode.workspace.registerTextDocumentContentProvider(scheme, {
      provideTextDocumentContent: () => '',
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document.uri.toString() === identity) {
        closes.push(transitions.closed(identity))
      }
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.uri.toString() === identity) {
        opens.push(transitions.opened(identity))
      }
    }),
  ]
  try {
    const document = await vscode.workspace.openTextDocument(uri)
    transitions.begin(identity)
    const changed = await vscode.languages.setTextDocumentLanguage(
      document,
      'markdown',
    )
    assert.equal(
      transitions.complete(
        identity,
        changed.uri.toString(),
        changed.languageId,
      ),
      true,
    )
    assert.deepEqual(closes, ['ignore'])
    assert.equal(opens.at(-1), true)
  } finally {
    transitions.finish(identity)
    for (const subscription of subscriptions) subscription.dispose()
  }
}

function previewDocuments(): readonly vscode.TextDocument[] {
  return vscode.workspace.textDocuments.filter(
    (document) => document.uri.scheme === previewScheme,
  )
}

function previewClient(text: string) {
  let currentText = text
  return {
    setText(value: string) {
      currentText = value
    },
    async sendRequest(_method: string, params: Record<string, unknown>) {
      const target = params.target as
        | {
            readonly kind: 'position'
          }
        | {
            readonly kind: 'template-range'
            readonly range: vscode.Range
          }
      return {
        protocolVersion: 1,
        uri: params.uri,
        openEpoch: params.openEpoch,
        version: params.version,
        sourceHash: params.sourceHash,
        kind: 'ready',
        selection: {
          ordinal: 0,
          range:
            target.kind === 'template-range'
              ? target.range
              : {
                  start: { line: 0, character: 15 },
                  end: { line: 0, character: 26 },
                },
        },
        requestStatus: 'complete',
        templateStatus: 'complete',
        previewStatus: 'complete',
        evidence: 'syntax-exact',
        text: currentText,
      }
    },
  }
}

async function eventually(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.fail(message)
}

async function closeDocumentTabs(uri: vscode.Uri): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.filter(
      (tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString() === uri.toString(),
    ),
  )
  assert.ok(tabs.length > 0, `No editor tab owns ${uri.toString()}.`)
  assert.equal(await vscode.window.tabGroups.close(tabs, true), true)
}
