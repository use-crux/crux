import type { ProjectDefinitionCatalogPresentation } from '@crux/core/catalog'

export function foldedCatalogChild(input: Omit<ProjectDefinitionCatalogPresentation, 'standalone'>): ProjectDefinitionCatalogPresentation {
  return {
    standalone: false,
    ...input,
  }
}
