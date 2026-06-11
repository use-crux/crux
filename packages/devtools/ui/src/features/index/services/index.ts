import { expectOk, fetchJson, postJson } from '@/shared/services/http'
import type { ProjectIndexData } from '@/types'

export type IndexData = ProjectIndexData

export const indexService = {
  async getIndex(signal?: AbortSignal): Promise<IndexData> {
    const payload = await fetchJson<Partial<IndexData> | null>('/api/index', signal)
    return {
      schemaVersion: payload?.schemaVersion ?? 1,
      prompts: payload?.prompts ?? [],
      contexts: payload?.contexts ?? [],
      tools: payload?.tools ?? [],
      project: payload?.project,
      indexedAt: payload?.indexedAt,
      indexing: payload?.indexing,
      definitions: payload?.definitions ?? [],
      relations: payload?.relations ?? [],
      diagnostics: payload?.diagnostics ?? [],
      lintFindings: payload?.lintFindings ?? [],
      sources: payload?.sources ?? [],
    }
  },

  /**
   * Trigger a project re-index. The Go service runs the index service
   * method synchronously and also publishes a fresh `index` WS snapshot,
   * so callers only need to invalidate the index query afterwards.
   */
  async reindex(): Promise<void> {
    const res = await postJson('/api/index/reindex', {})
    await expectOk(res, 'reindex index')
  },
}
