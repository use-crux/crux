import { fingerprint } from './definitions'

/** Static catalog fact for one authored Quality assertion/check site. */
export interface EvaluationAssertionSiteFact {
  readonly assertionSiteId: string
  readonly callbackKind: 'expect' | 'assert'
  readonly callbackLevel: 'evaluation' | 'case' | 'unknown'
  readonly authoredFile: string
  readonly line: number
  readonly column: number
  readonly sourceRef: string
  readonly normalizedAssertionText: string
}

/** Extract assertion/check site facts from an authored evaluation source file. */
export function assertionSitesFromSource(input: {
  readonly file: string
  readonly exportName: string
  readonly source: string
}): readonly EvaluationAssertionSiteFact[] {
  const lines = input.source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  return lines.flatMap((text, index) => {
    const match = assertionCallMatch(text)
    if (match === undefined) return []

    const line = index + 1
    const column = match.column + 1
    const callbackLevel = callbackLevelNear(lines, index)
    const normalizedAssertionText = normalizeAssertionText(text.slice(match.column))
    const assertionSiteId = `assertion-site:${fingerprint({
      authoredFile: input.file,
      exportName: input.exportName,
      callbackKind: match.kind,
      callbackLevel,
      line,
      column,
      normalizedAssertionText,
    })}`

    return [
      {
        assertionSiteId,
        callbackKind: match.kind,
        callbackLevel,
        authoredFile: input.file,
        line,
        column,
        sourceRef: `${input.file}:${line}:${column}`,
        normalizedAssertionText,
      },
    ]
  })
}

function assertionCallMatch(text: string): { readonly kind: 'expect' | 'assert'; readonly column: number } | undefined {
  const expectIndex = firstCallIndex(text, 'ctx.expect')
  const assertIndex = firstCallIndex(text, 'ctx.assert')
  if (expectIndex === undefined && assertIndex === undefined) return undefined
  if (expectIndex !== undefined && (assertIndex === undefined || expectIndex < assertIndex)) {
    return { kind: 'expect', column: expectIndex }
  }
  return assertIndex === undefined ? undefined : { kind: 'assert', column: assertIndex }
}

function firstCallIndex(text: string, callee: string): number | undefined {
  const index = text.indexOf(callee)
  if (index < 0) return undefined
  const after = text.slice(index + callee.length).trimStart()
  return after.startsWith('(') || after.startsWith('.soft') ? index : undefined
}

function callbackLevelNear(lines: readonly string[], lineIndex: number): EvaluationAssertionSiteFact['callbackLevel'] {
  for (let index = lineIndex; index >= 0 && lineIndex - index < 20; index--) {
    const text = lines[index]?.trim() ?? ''
    if (/^expect\s*:/.test(text)) return 'evaluation'
    if (/^assert\s*:/.test(text)) return 'evaluation'
    if (/\bexpect\s*:/.test(text) && /\binput\s*:/.test(text)) return 'case'
  }
  return 'unknown'
}

function normalizeAssertionText(text: string): string {
  return text.trim().replace(/;$/, '')
}
