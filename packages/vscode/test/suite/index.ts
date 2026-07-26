import assert from 'node:assert/strict'
import * as vscode from 'vscode'
import {
  promptTextFixtureSource,
  semanticHighlightingFixtures,
} from '../fixtures.js'
import { ExtensionHostDecorationSurface } from './decoration-host.js'
import { captureInterpolationProviders } from './interpolation-providers.js'
import { runThemeEvidence } from './theme-evidence.js'

const semanticTokenTimeoutMs = 10_000

/** Run the real VS Code decoration and semantic-token compatibility smoke. */
export async function run(): Promise<void> {
  const evidenceTheme = process.env.CRUX_PROMPT_TEXT_EVIDENCE_THEME
  if (evidenceTheme !== undefined) {
    await runThemeEvidence(
      evidenceTheme,
      Number(process.env.CRUX_PROMPT_TEXT_EVIDENCE_WAIT_MS ?? 12000),
    )
    return
  }

  const typescript = vscode.extensions.getExtension('vscode.typescript-language-features')
  assert.ok(typescript, 'The built-in TypeScript extension is unavailable.')
  await typescript.activate()

  const document = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content: promptTextFixtureSource,
  })
  const editor = await vscode.window.showTextDocument(document, { preview: false })
  assert.equal(document.getText(), promptTextFixtureSource)

  const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
    'vscode.provideDocumentSemanticTokensLegend',
    document.uri,
  )
  assert.ok(legend, 'The built-in TypeScript semantic-token legend is unavailable.')

  for (const fixture of semanticHighlightingFixtures) {
    await vscode.workspace.getConfiguration('editor').update(
      'semanticHighlighting.enabled',
      fixture.enabled,
      vscode.ConfigurationTarget.Global,
    )
    const before = await stableSemanticTokenBytes(document.uri)
    assert.ok(before.length > 0, 'TypeScript returned an empty semantic-token stream.')
    assert.equal(
      before.length % (5 * Uint32Array.BYTES_PER_ELEMENT),
      0,
      'TypeScript semantic-token bytes are not complete five-integer tuples.',
    )
    const providersBefore = await captureInterpolationProviders(document.uri)
    const surface = new ExtensionHostDecorationSurface()
    try {
      surface.apply(editor, fixture.decorations)
      const after = await stableSemanticTokenBytes(document.uri)
      const providersAfter = await captureInterpolationProviders(document.uri)
      assert.deepEqual(
        after,
        before,
        `TypeScript semantic tokens changed with PromptText decorations in mode ${fixture.enabled}.`,
      )
      assert.deepEqual(
        providersAfter,
        providersBefore,
        `TypeScript interpolation providers changed in mode ${fixture.enabled}.`,
      )

      const versionBeforeEdit = document.version
      const edited = await editor.edit((builder) => {
        builder.insert(document.lineAt(8).range.end, ';')
      })
      assert.equal(edited, true, 'The extension-host edit was rejected.')
      assert.ok(document.version > versionBeforeEdit, 'The editor version did not advance.')
      surface.clear(editor)
      assert.equal(surface.updateCount, 14, 'Disable should clear all seven roles.')
      surface.apply(editor, fixture.decorations)
      assert.equal(surface.updateCount, 21, 'Edit should replace all seven roles after clearing.')
      surface.clear(editor)
      assert.equal(surface.updateCount, 28)
    } finally {
      surface.dispose()
    }
  }
}

async function stableSemanticTokenBytes(uri: vscode.Uri): Promise<readonly number[]> {
  const deadline = Date.now() + semanticTokenTimeoutMs
  let previous: readonly number[] | undefined
  while (Date.now() < deadline) {
    const tokens = await vscode.commands.executeCommand<vscode.SemanticTokens>(
      'vscode.provideDocumentSemanticTokens',
      uri,
    )
    if (tokens !== undefined) {
      const current = [...new Uint8Array(
        tokens.data.buffer,
        tokens.data.byteOffset,
        tokens.data.byteLength,
      )]
      if (previous !== undefined && arraysEqual(previous, current)) return current
      previous = current
    }
    await delay(50)
  }
  throw new Error('Timed out waiting for stable TypeScript semantic tokens.')
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
