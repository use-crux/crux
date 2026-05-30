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
}
