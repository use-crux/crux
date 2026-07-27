import * as vscode from 'vscode'
import type { PromptTextPreviewCommandTarget } from '../commands.js'
import { PromptTextDocumentRevisions } from '../document-revisions.js'
import { isPromptTextSourceDocument } from '../documents.js'
import { promptTextPreviewMetadataCommand } from './metadata.js'
import type {
  PromptTextPreviewDocument,
  PromptTextPreviewDocumentProvider,
} from './provider.js'
import type {
  PromptTextPreviewSelection,
  PromptTextPreviewSource,
} from './types.js'
import type { PromptTextPreviewResourceIdentity } from './metadata.js'
import { promptTextPreviewChoiceLabel } from './selection.js'

/** Private scheme shared by provider, CodeLens, and lifecycle filters. */
export const promptTextPreviewScheme = 'crux-prompt-preview'

/** Convert one slot identity to its exact private virtual-document URI. */
export function createPreviewUri(
  identity: PromptTextPreviewResourceIdentity,
): vscode.Uri {
  return vscode.Uri.from({
    scheme: promptTextPreviewScheme,
    path: identity.path,
    query: identity.query,
  })
}

/** Return the sole active source editor and its primary active position. */
export function activePreviewTarget(
  revisions: PromptTextDocumentRevisions,
): PromptTextPreviewCommandTarget | undefined {
  const editor = vscode.window.activeTextEditor
  if (editor === undefined || !isPromptTextSourceDocument(editor.document)) {
    return undefined
  }
  const source = sourceSnapshot(revisions, editor.document)
  return source === undefined
    ? undefined
    : {
        source,
        position: {
          line: editor.selection.active.line,
          character: editor.selection.active.character,
        },
      }
}

/** Snapshot one open source with strict UTF-16 position conversion. */
export function sourceSnapshot(
  revisions: PromptTextDocumentRevisions,
  document: vscode.TextDocument,
): PromptTextPreviewSource | undefined {
  const text = document.getText()
  const stamp = revisions.stamp({
    uri: document.uri.toString(),
    version: document.version,
    text,
  })
  return {
    ...stamp,
    sourcePath: document.uri.path,
    documentLength: text.length,
    offsetAt: (position) => strictOffsetAt(document, position),
    positionAt: (offset) =>
      offset < 0 || offset > text.length
        ? undefined
        : toPosition(document.positionAt(offset)),
  }
}

/** Find an open VS Code document by exact URI string. */
export function findDocument(uri: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find(
    (document) => document.uri.toString() === uri,
  )
}

/** Capture the narrow virtual-document fields used for byte verification. */
export function previewDocument(
  document: vscode.TextDocument,
): PromptTextPreviewDocument {
  return {
    uri: document.uri.toString(),
    languageId: document.languageId,
    eol: document.eol === vscode.EndOfLine.CRLF ? 'crlf' : 'lf',
    text: document.getText(),
  }
}

/** Present request-local choices without treating ordinals as identity. */
export async function chooseTemplate(
  choices: readonly PromptTextPreviewSelection[],
): Promise<PromptTextPreviewSelection | undefined> {
  const selected = await vscode.window.showQuickPick(
    choices.map((choice) => ({
      label: promptTextPreviewChoiceLabel(choice),
      choice,
    })),
  )
  return selected?.choice
}

/** Return the empty-document-safe metadata lens for one preview resource. */
export function previewCodeLenses(
  provider: PromptTextPreviewDocumentProvider,
  document: vscode.TextDocument,
): vscode.CodeLens[] {
  const title = provider.provideCodeLensTitle(document.uri.toString())
  return title === undefined
    ? []
    : [
        new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
          title,
          command: promptTextPreviewMetadataCommand,
        }),
      ]
}

function strictOffsetAt(
  document: vscode.TextDocument,
  position: { readonly line: number; readonly character: number },
): number | undefined {
  if (
    !Number.isInteger(position.line) ||
    !Number.isInteger(position.character) ||
    position.line < 0 ||
    position.character < 0 ||
    position.line >= document.lineCount
  )
    return undefined
  const line = document.lineAt(position.line)
  return position.character > line.text.length
    ? undefined
    : document.offsetAt(new vscode.Position(position.line, position.character))
}

function toPosition(position: vscode.Position) {
  return { line: position.line, character: position.character }
}
