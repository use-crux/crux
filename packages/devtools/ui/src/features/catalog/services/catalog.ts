import { expectOk, fetchJson, postJson } from '@/shared/services/http'
import type { ProjectCatalogData } from '@/types'

export type CatalogData = ProjectCatalogData

export const catalogService = {
  async getCatalog(signal?: AbortSignal): Promise<CatalogData> {
    const payload = await fetchJson<Partial<CatalogData> | null>('/api/catalog', signal)
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
   * Trigger a project re-index. The Go service runs the catalog service
   * method synchronously and also publishes a fresh `catalog` WS snapshot,
   * so callers only need to invalidate the catalog query afterwards.
   */
  async reindex(): Promise<void> {
    const res = await postJson('/api/catalog/reindex', {})
    await expectOk(res, 'reindex catalog')
  },
}
