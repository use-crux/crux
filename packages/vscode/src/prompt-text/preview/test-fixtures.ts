import type {
  PromptTextPreviewReadyResult,
  PromptTextPreviewSource,
} from './types.js'

export function previewSource(
  text = 'zero\none\ntwo\n0123456789\nfour\nfive',
  changes: {
    readonly uri?: string
    readonly version?: number
    readonly sourceHash?: string
    readonly openEpoch?: number
  } = {},
): PromptTextPreviewSource & { readonly text: string } {
  return {
    uri: changes.uri ?? 'file:///repo/writer.ts',
    sourcePath: '/repo/writer.ts',
    openEpoch: changes.openEpoch ?? 2,
    version: changes.version ?? 7,
    sourceHash: changes.sourceHash ?? 'a'.repeat(64),
    documentLength: text.length,
    offsetAt: (position) => offsetAt(text, position),
    positionAt: (offset) => positionAt(text, offset),
    text,
  }
}

export function readyResult(
  source: PromptTextPreviewSource,
  selectionRange = range(3, 1, 5, 2),
): PromptTextPreviewReadyResult {
  return {
    protocolVersion: 1,
    uri: source.uri,
    openEpoch: source.openEpoch,
    version: source.version,
    sourceHash: source.sourceHash,
    kind: 'ready',
    selection: {
      ordinal: 0,
      range: selectionRange,
    },
    requestStatus: 'complete',
    templateStatus: 'complete',
    previewStatus: 'complete',
    evidence: 'syntax-exact',
    text: '# Hello\n',
  }
}

export function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  }
}

function offsetAt(
  text: string,
  position: { readonly line: number; readonly character: number },
) {
  const lines = text.split('\n')
  if (position.line < 0 || position.line >= lines.length) return undefined
  const line = lines[position.line]
  if (
    line === undefined ||
    position.character < 0 ||
    position.character > line.length
  )
    return undefined
  let offset = 0
  for (let index = 0; index < position.line; index++) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  return offset + position.character
}

function positionAt(text: string, target: number) {
  if (!Number.isInteger(target) || target < 0 || target > text.length) {
    return undefined
  }
  let offset = 0
  const lines = text.split('\n')
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line] ?? ''
    if (target <= offset + value.length) {
      return { line, character: target - offset }
    }
    offset += value.length + 1
  }
  return undefined
}
