import type { IndexExtractor, IndexerExtension } from './types'

/**
 * Extractor paired with the extension identity that owns it.
 *
 * Keeping this pair avoids passing global extension state through extractor functions and gives
 * diagnostics/cache code enough context to identify the exact contribution that ran.
 */
export interface RegisteredExtractor {
  readonly extension: IndexerExtension
  readonly extractor: IndexExtractor
}

/**
 * Precomputed extractor dispatch tables for one normalized extension registry.
 *
 * Static extraction runs this lookup for every syntax match. Building the tables once keeps user
 * extension cost proportional to relevant patterns instead of every installed extractor.
 */
export interface ExtractorDispatchIndex {
  readonly callsByName: ReadonlyMap<string, readonly RegisteredExtractor[]>
  readonly importedCallsByNameAndSource: ReadonlyMap<string, ReadonlyMap<string, readonly RegisteredExtractor[]>>
  readonly constructorsByName: ReadonlyMap<string, readonly RegisteredExtractor[]>
  readonly objects: readonly RegisteredExtractor[]
  readonly order: ReadonlyMap<RegisteredExtractor, number>
}

/** Builds dispatch tables while preserving normalized registry order. */
export function createExtractorDispatchIndex(extractors: readonly RegisteredExtractor[]): ExtractorDispatchIndex {
  const callsByName = new Map<string, RegisteredExtractor[]>()
  const importedCallsByNameAndSource = new Map<string, Map<string, RegisteredExtractor[]>>()
  const constructorsByName = new Map<string, RegisteredExtractor[]>()
  const objects: RegisteredExtractor[] = []
  const order = new Map<RegisteredExtractor, number>()

  for (const [index, item] of extractors.entries()) {
    order.set(item, index)
    for (const pattern of item.extractor.patterns) {
      switch (pattern.kind) {
        case 'call':
          if (pattern.importFrom) {
            addImportedCallExtractors(importedCallsByNameAndSource, pattern.name, pattern.importFrom, item)
          } else {
            addIndexedExtractor(callsByName, pattern.name, item)
          }
          break
        case 'new':
          addIndexedExtractor(constructorsByName, pattern.name, item)
          break
        case 'object':
          addUniqueExtractor(objects, item)
          break
      }
    }
  }

  return {
    callsByName: freezeExtractorMap(callsByName),
    importedCallsByNameAndSource: freezeNestedExtractorMap(importedCallsByNameAndSource),
    constructorsByName: freezeExtractorMap(constructorsByName),
    objects: Object.freeze([...objects]),
    order,
  }
}

/** Selects call extractors from indexed local and import-qualified pattern tables. */
export function indexedExtractorsForCall(
  index: ExtractorDispatchIndex,
  callName: string,
  importSource?: string,
  importName?: string,
): readonly RegisteredExtractor[] {
  const candidates = [
    ...(index.callsByName.get(callName) ?? []),
    ...importQualifiedCallCandidates(index.importedCallsByNameAndSource, importName ?? callName, importSource),
  ]
  return inRegistryOrder(candidates, index.order)
}

/** Selects constructor extractors from the indexed constructor table. */
export function indexedExtractorsForNew(
  index: ExtractorDispatchIndex,
  constructorName: string,
): readonly RegisteredExtractor[] {
  return index.constructorsByName.get(constructorName) ?? []
}

/** Selects object-literal extractors from the indexed object table. */
export function indexedExtractorsForObject(index: ExtractorDispatchIndex): readonly RegisteredExtractor[] {
  return index.objects
}

function importQualifiedCallCandidates(
  callsByNameAndSource: ReadonlyMap<string, ReadonlyMap<string, readonly RegisteredExtractor[]>>,
  importName: string,
  importSource: string | undefined,
): readonly RegisteredExtractor[] {
  if (!importSource) return []
  return callsByNameAndSource.get(importName)?.get(importSource) ?? []
}

function addIndexedExtractor(
  map: Map<string, RegisteredExtractor[]>,
  key: string,
  item: RegisteredExtractor,
): void {
  const current = map.get(key)
  if (current) {
    addUniqueExtractor(current, item)
    return
  }
  map.set(key, [item])
}

function addUniqueExtractor(items: RegisteredExtractor[], item: RegisteredExtractor): void {
  if (!items.includes(item)) items.push(item)
}

function addImportedCallExtractors(
  map: Map<string, Map<string, RegisteredExtractor[]>>,
  name: string,
  importSources: readonly string[],
  item: RegisteredExtractor,
): void {
  let bySource = map.get(name)
  if (!bySource) {
    bySource = new Map()
    map.set(name, bySource)
  }
  for (const source of importSources) addIndexedExtractor(bySource, source, item)
}

function freezeExtractorMap(
  map: Map<string, RegisteredExtractor[]>,
): ReadonlyMap<string, readonly RegisteredExtractor[]> {
  return new Map([...map].map(([key, value]) => [key, Object.freeze([...value])] as const))
}

function freezeNestedExtractorMap(
  map: Map<string, Map<string, RegisteredExtractor[]>>,
): ReadonlyMap<string, ReadonlyMap<string, readonly RegisteredExtractor[]>> {
  return new Map([...map].map(([key, value]) => [key, freezeExtractorMap(value)] as const))
}

function inRegistryOrder(
  candidates: readonly RegisteredExtractor[],
  order: ReadonlyMap<RegisteredExtractor, number>,
): readonly RegisteredExtractor[] {
  const unique = [...new Set(candidates)]
  unique.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  return unique
}
