import type { ProjectCatalogSnapshot } from '@crux/core/catalog'

export type ProjectIndexingSessionMode = 'full' | 'source-only'

export interface ProjectIndexingSessionOptions {
  root: string
  configPath?: string
  projectName?: string
  mode?: ProjectIndexingSessionMode
  indexedAt?: string
}

export interface ProjectIndexingSession {
  run(): Promise<ProjectCatalogSnapshot>
}
