import assert from 'node:assert/strict'
import * as vscode from 'vscode'
import {
  promptTextFixtureSource,
  semanticHighlightingFixtures,
} from '../fixtures.js'
import { ExtensionHostDecorationSurface } from './decoration-host.js'

/**
 * Hold a decorated editor open for visual theme, selection, cursor, and
 * diagnostic inspection.
 *
 * Decoration types are created and applied under the opposite base theme,
 * then the requested theme is selected without recreating them. This makes the
 * evidence exercise the real `ThemeColor` transition rather than a reload.
 */
export async function runThemeEvidence(
  theme: string,
  waitMilliseconds: number,
): Promise<void> {
  const typescript = vscode.extensions.getExtension('vscode.typescript-language-features')
  assert.ok(typescript, 'The built-in TypeScript extension is unavailable.')
  await typescript.activate()

  const document = await vscode.workspace.openTextDocument({
    language: 'typescript',
    content: promptTextFixtureSource,
  })
  const editor = await vscode.window.showTextDocument(document, { preview: false })
  await setTheme(oppositeTheme(theme))

  const surface = new ExtensionHostDecorationSurface()
  const diagnostics = vscode.languages.createDiagnosticCollection(
    'crux-prompt-text-theme-evidence',
  )
  try {
    surface.apply(editor, semanticHighlightingFixtures[0].decorations)
    const versionBeforeEdit = document.version
    const edited = await editor.edit((builder) => {
      builder.insert(document.lineAt(8).range.end, ';')
    })
    assert.equal(edited, true)
    assert.ok(document.version > versionBeforeEdit)
    surface.clear(editor)
    surface.apply(editor, semanticHighlightingFixtures[0].decorations)
    const updateCountBeforeTheme = surface.updateCount

    diagnostics.set(document.uri, [
      new vscode.Diagnostic(
        new vscode.Range(6, 8, 6, 13),
        'PromptText decoration compatibility evidence.',
        vscode.DiagnosticSeverity.Warning,
      ),
    ])
    editor.selections = [
      new vscode.Selection(4, 20, 4, 25),
      new vscode.Selection(6, 43, 6, 43),
    ]
    editor.revealRange(new vscode.Range(4, 0, 7, 1))

    await setTheme(theme)
    assert.equal(vscode.window.activeColorTheme.kind, expectedThemeKind(theme))
    assert.equal(surface.updateCount, updateCountBeforeTheme)
    console.log(`CRUX_PROMPT_TEXT_THEME_READY ${JSON.stringify({
      theme,
      kind: vscode.window.activeColorTheme.kind,
      updateCount: surface.updateCount,
    })}`)
    await delay(waitMilliseconds)
  } finally {
    diagnostics.dispose()
    surface.clear(editor)
    surface.dispose()
  }
}

async function setTheme(theme: string): Promise<void> {
  await vscode.workspace.getConfiguration('workbench').update(
    'colorTheme',
    theme,
    vscode.ConfigurationTarget.Global,
  )
  const expected = expectedThemeKind(theme)
  const deadline = Date.now() + 5_000
  while (vscode.window.activeColorTheme.kind !== expected) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out changing the VS Code theme to ${theme}.`)
    }
    await delay(50)
  }
}

function oppositeTheme(theme: string): string {
  return expectedThemeKind(theme) === vscode.ColorThemeKind.Light
    || expectedThemeKind(theme) === vscode.ColorThemeKind.HighContrastLight
    ? 'Default Dark+'
    : 'Default Light+'
}

function expectedThemeKind(theme: string): vscode.ColorThemeKind {
  switch (theme) {
    case 'Default Dark+':
      return vscode.ColorThemeKind.Dark
    case 'Default Light+':
      return vscode.ColorThemeKind.Light
    case 'Default High Contrast':
      return vscode.ColorThemeKind.HighContrast
    case 'Default High Contrast Light':
      return vscode.ColorThemeKind.HighContrastLight
    default:
      throw new Error(`Unsupported PromptText evidence theme: ${theme}`)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
