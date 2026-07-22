/** General inline-diagnostics extensions that Crux coexists with in auto mode. Additions are cheap. */
export const inlineDiagnosticsExtensionIds = [
  'usernamehw.errorlens',
  'PolyMeilex.reason-error-lens',
] as const

export type DecorationMode = 'auto' | 'on' | 'off'

export const decorationSeverities = ['error', 'warning', 'information', 'hint'] as const
export type DecorationSeverity = (typeof decorationSeverities)[number]

/** Minimal diagnostic data needed by the client-side decoration policy. */
export interface DecorationDiagnostic {
  readonly line: number
  readonly severity?: number
  readonly code: string | number
  readonly message: string
}

/** One selected inline decoration anchored to a document line. */
export interface LineDecoration {
  readonly line: number
  readonly severity: DecorationSeverity
  readonly text: string
}

export interface DecorationModeResolution {
  readonly enabled: boolean
  readonly detectedExtensionId?: string
}

interface SelectedDiagnostic {
  readonly diagnostic: DecorationDiagnostic
  readonly severity: DecorationSeverity
  readonly count: number
}

const severityByNumber: Readonly<Record<number, DecorationSeverity>> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
}

const severityRank: Readonly<Record<DecorationSeverity, number>> = {
  error: 0,
  warning: 1,
  information: 2,
  hint: 3,
}

const glyphBySeverity: Readonly<Record<DecorationSeverity, string>> = {
  error: '✖',
  warning: '⚠',
  information: 'ℹ',
  hint: '○',
}

/** Selects and renders at most one deterministic decoration per source line. */
export function buildLineDecorations(
  diagnostics: readonly DecorationDiagnostic[],
  maxLength: number,
): readonly LineDecoration[] {
  const selected = new Map<number, SelectedDiagnostic>()
  for (const diagnostic of diagnostics) {
    const severity = severityByNumber[diagnostic.severity ?? 3] ?? 'information'
    const current = selected.get(diagnostic.line)
    if (current === undefined) {
      selected.set(diagnostic.line, { diagnostic, severity, count: 1 })
      continue
    }
    selected.set(diagnostic.line, {
      diagnostic: severityRank[severity] < severityRank[current.severity]
        ? diagnostic
        : current.diagnostic,
      severity: severityRank[severity] < severityRank[current.severity]
        ? severity
        : current.severity,
      count: current.count + 1,
    })
  }

  const limit = normalizeMaxLength(maxLength)
  return [...selected.entries()]
    .sort(([left], [right]) => left - right)
    .map(([line, value]) => {
      const firstLine = value.diagnostic.message.split(/\r\n|\r|\n/, 1)[0] ?? ''
      const base = `${glyphBySeverity[value.severity]} ${value.diagnostic.code}: ${firstLine}`
      const suffix = value.count > 1 ? ` +${value.count - 1}` : ''
      return {
        line,
        severity: value.severity,
        text: truncateWithSuffix(base, suffix, limit),
      }
    })
}

/** Resolves the user setting against active coexistence extensions. */
export function resolveDecorationMode(
  mode: DecorationMode,
  activeExtensionIds: readonly string[],
): DecorationModeResolution {
  if (mode === 'on') return { enabled: true }
  if (mode === 'off') return { enabled: false }
  const active = new Set(activeExtensionIds)
  const detectedExtensionId = inlineDiagnosticsExtensionIds.find((id) => active.has(id))
  return detectedExtensionId === undefined
    ? { enabled: true }
    : { enabled: false, detectedExtensionId }
}

/** Filters a diagnostics event to unique currently visible document URIs. */
export function filterAffectedVisibleUris(
  affectedUris: readonly string[],
  visibleUris: readonly string[],
): readonly string[] {
  const affected = new Set(affectedUris)
  const emitted = new Set<string>()
  return visibleUris.filter((uri) => {
    if (!affected.has(uri) || emitted.has(uri)) return false
    emitted.add(uri)
    return true
  })
}

function normalizeMaxLength(value: number): number {
  if (!Number.isFinite(value)) return 80
  return Math.max(1, Math.floor(value))
}

function truncateWithSuffix(base: string, suffix: string, maxLength: number): string {
  const full = Array.from(base + suffix)
  if (full.length <= maxLength) return full.join('')
  const suffixCharacters = Array.from(suffix)
  if (suffixCharacters.length >= maxLength) {
    return truncateCharacters(suffixCharacters, maxLength)
  }
  return truncateCharacters(Array.from(base), maxLength - suffixCharacters.length) + suffix
}

function truncateCharacters(characters: readonly string[], maxLength: number): string {
  if (characters.length <= maxLength) return characters.join('')
  if (maxLength <= 1) return '…'.slice(0, maxLength)
  return characters.slice(0, maxLength - 1).join('') + '…'
}
