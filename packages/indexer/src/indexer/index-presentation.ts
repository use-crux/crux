import type { ProjectDefinitionIndexPresentation } from '@use-crux/core/project-index'

export function foldedIndexChild(
  input: Omit<ProjectDefinitionIndexPresentation, 'standalone'>,
): ProjectDefinitionIndexPresentation {
  return {
    standalone: false,
    ...input,
  }
}
