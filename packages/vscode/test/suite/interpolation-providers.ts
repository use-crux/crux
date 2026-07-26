import assert from 'node:assert/strict'
import * as vscode from 'vscode'

const interpolationPosition = new vscode.Position(5, 18)

/**
 * Capture native TypeScript features at the expression inside `${name}`.
 *
 * The normalized snapshot deliberately excludes object identity while
 * retaining user-visible completion, hover, and definition results.
 */
export async function captureInterpolationProviders(
  uri: vscode.Uri,
): Promise<unknown> {
  const completions = await vscode.commands.executeCommand<
    vscode.CompletionList | readonly vscode.CompletionItem[] | undefined
  >('vscode.executeCompletionItemProvider', uri, interpolationPosition)
  const completionItems = completions instanceof vscode.CompletionList
    ? completions.items
    : completions ?? []
  const normalizedCompletions = completionItems
    .map((item) => ({
      label: completionLabel(item.label),
      kind: item.kind,
      detail: item.detail,
      sortText: item.sortText,
      filterText: item.filterText,
      insertText: typeof item.insertText === 'string'
        ? item.insertText
        : item.insertText?.value,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  assert.ok(
    normalizedCompletions.some(({ label }) => label.label === 'name'),
    'TypeScript completion did not include the local interpolation binding.',
  )

  const hovers = await vscode.commands.executeCommand<readonly vscode.Hover[] | undefined>(
    'vscode.executeHoverProvider',
    uri,
    interpolationPosition,
  )
  assert.ok(hovers !== undefined && hovers.length > 0, 'TypeScript hover is unavailable.')

  const definitions = await vscode.commands.executeCommand<
    readonly (vscode.Location | vscode.LocationLink)[] | undefined
  >('vscode.executeDefinitionProvider', uri, interpolationPosition)
  assert.ok(
    definitions !== undefined && definitions.length > 0,
    'TypeScript definition is unavailable.',
  )

  return {
    completions: normalizedCompletions,
    hovers: hovers.map((hover) => ({
      contents: hover.contents.map(normalizeHoverContent),
      range: normalizeRange(hover.range),
    })),
    definitions: definitions.map(normalizeDefinition),
  }
}

function completionLabel(label: string | vscode.CompletionItemLabel): {
  readonly label: string
  readonly detail?: string
  readonly description?: string
} {
  return typeof label === 'string'
    ? { label }
    : {
        label: label.label,
        detail: label.detail,
        description: label.description,
      }
}

function normalizeHoverContent(
  content: vscode.MarkdownString | vscode.MarkedString,
): unknown {
  if (content instanceof vscode.MarkdownString) {
    return { kind: 'markdown', value: content.value }
  }
  return typeof content === 'string'
    ? { kind: 'text', value: content }
    : { kind: 'code', language: content.language, value: content.value }
}

function normalizeDefinition(
  definition: vscode.Location | vscode.LocationLink,
): unknown {
  if ('targetUri' in definition) {
    return {
      kind: 'link',
      uri: definition.targetUri.toString(),
      range: normalizeRange(definition.targetRange),
      selectionRange: normalizeRange(definition.targetSelectionRange),
      originRange: normalizeRange(definition.originSelectionRange),
    }
  }
  return {
    kind: 'location',
    uri: definition.uri.toString(),
    range: normalizeRange(definition.range),
  }
}

function normalizeRange(range: vscode.Range | undefined): unknown {
  if (range === undefined) return undefined
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  }
}
