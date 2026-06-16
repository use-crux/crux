import { postJson } from './http'

export interface SourceLocation {
  file: string
  line: number
  column?: number
  function?: string
}

export interface ResolvedLocation extends SourceLocation {
  resolved: boolean
}

export interface ResolvedFnSource {
  source: string
  file: string
  startLine: number
  resolved: boolean
}

export type SourceFrameRole = 'context' | 'failed' | 'passed' | 'not-evaluated'

export interface SourceFrameLine {
  line: number
  text: string
  role: SourceFrameRole
}

export type SourceFrameResolution =
  | {
      kind: 'source-frame'
      sourceRef: string
      authoredFile: string
      authoredLine: number
      authoredColumn?: number
      frameStartLine: number
      frameEndLine: number
      lines: readonly SourceFrameLine[]
      contentHash: string
      capturedAt: string
      stale: boolean
      resolver: 'source-map' | 'catalog' | 'disk'
    }
  | {
      kind: 'unavailable'
      reason:
        | 'no-source-ref'
        | 'invalid-source-ref'
        | 'source-map-missing'
        | 'source-file-missing'
        | 'source-line-missing'
        | 'source-root-missing'
        | 'source-outside-project'
        | 'unsupported-language'
        | 'unsupported-source-file'
    }

export const sourceResolverService = {
  async resolveSources(locations: readonly SourceLocation[]): Promise<ResolvedLocation[] | null> {
    const response = await postJson('/api/resolve-source', { locations })
    if (!response.ok) return null
    return ((await response.json()) as { locations: ResolvedLocation[] }).locations
  },

  async resolveFnSource(input: { file: string; line: number; column?: number }): Promise<ResolvedFnSource | null> {
    const response = await postJson('/api/resolve-fn-source', input)
    if (!response.ok) return null
    const data = (await response.json()) as ResolvedFnSource | { source: null; resolved: false }
    return data.source ? (data as ResolvedFnSource) : null
  },

  async resolveSourceFrame(input: {
    file: string
    line: number
    column?: number
    sourceRef?: string
    frameRadius?: number
    role?: SourceFrameRole
    capturedAt?: string
  }): Promise<SourceFrameResolution | null> {
    const response = await postJson('/api/resolve-source-frame', input)
    if (!response.ok) return null
    return (await response.json()) as SourceFrameResolution
  },
}
