import { fetchJson } from '@/shared/services/http'
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
      definitions: payload?.definitions ?? [],
      relations: payload?.relations ?? [],
      diagnostics: payload?.diagnostics ?? [],
      lintFindings: payload?.lintFindings ?? [],
      sources: payload?.sources ?? [],
    }
  },
}
