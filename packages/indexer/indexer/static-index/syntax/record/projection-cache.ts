import type { ProjectDefinition } from '@crux/core/project-index'

type ImportedDefinitionLoader = () => Promise<ProjectDefinition | undefined>

/** Pass-local cache for syntax-record projection lookups. */
export interface StaticRecordProjectionCache {
  /**
   * Reads a projected definition for an imported symbol.
   *
   * The cache is scoped to one extraction pass and stores promises so parallel
   * files that import the same symbol share the same extractor work.
   */
  readImportedDefinition(input: {
    readonly file: string
    readonly importedName: string
    readonly load: ImportedDefinitionLoader
  }): Promise<ProjectDefinition | undefined>
}

/** Creates an empty pass-local projection cache. */
export function createStaticRecordProjectionCache(): StaticRecordProjectionCache {
  const importedDefinitions = new Map<string, Promise<ProjectDefinition | undefined>>()
  return {
    readImportedDefinition: ({ file, importedName, load }) => {
      const key = `${file}\0${importedName}`
      const cached = importedDefinitions.get(key)
      if (cached) return cached
      const loaded = load()
      importedDefinitions.set(key, loaded)
      return loaded
    },
  }
}
