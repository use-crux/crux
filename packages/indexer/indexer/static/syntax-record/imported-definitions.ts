import type { ProjectDefinition } from '@crux/core/project-index'
import type { IndexerExtensionRuntime } from '../../extensions'
import { staticFoundDefinitionsFromExtractedFacts } from '../../static-index/compatibility/syntax-record-bridge/normalizer'
import type { StaticFoundDefinition } from '../../types'
import type { StaticRecordProjectionCache } from './projection-cache'
import type { StaticSyntaxFileRecord } from './types'
import { createNativeFactIndex, extractedFacts, type NativeFactProjectionMode } from './native-facts'

export interface ImportedDefinitionsInput {
  readonly root: string
  readonly runtime: IndexerExtensionRuntime
  readonly record: StaticSyntaxFileRecord
  readonly readRecord: (file: string) => Promise<StaticSyntaxFileRecord>
  readonly projectionCache?: StaticRecordProjectionCache
  /**
   * Projection lane requesting imported definitions.
   *
   * Imported definitions intentionally keep both native and TypeScript support
   * facts available so cross-lane relation references can resolve after the
   * emitted facts are merged by the caller.
   */
  readonly nativeFactProjection?: NativeFactProjectionMode
}

/** Projects definitions needed to bind source-local import relation refs. */
export async function importedDefinitionsForFactRelations(
  input: ImportedDefinitionsInput,
): Promise<Map<string, ProjectDefinition>> {
  const definitions = new Map<string, ProjectDefinition>()
  for (const importRecord of input.record.imports) {
    if (!importRecord.resolvedFile || importRecord.importedName === 'default') continue
    const found = input.projectionCache
      ? await input.projectionCache.readImportedDefinition({
          file: importRecord.resolvedFile,
          importedName: importRecord.importedName,
          load: async () =>
            (
              await importedDefinitionForImport(
                input.root,
                input.runtime,
                importRecord.resolvedFile!,
                importRecord.importedName,
                input.readRecord,
              )
            )?.definition,
        })
      : (await importedDefinitionForImport(
          input.root,
          input.runtime,
          importRecord.resolvedFile,
          importRecord.importedName,
          input.readRecord,
        ))?.definition
    if (found) definitions.set(importRecord.localName, found)
  }
  return definitions
}

async function importedDefinitionForImport(
  root: string,
  runtime: IndexerExtensionRuntime,
  file: string,
  importedName: string,
  readRecord: (file: string) => Promise<StaticSyntaxFileRecord>,
): Promise<StaticFoundDefinition | undefined> {
  const importedRecord = await safeReadRecord(readRecord, file)
  if (!importedRecord) return undefined
  const matchIndex = importedRecord.matches.findIndex((item) => item.variableName === importedName)
  if (matchIndex === -1) return undefined
  const match = importedRecord.matches[matchIndex]
  if (!match) return undefined
  const nativeFacts = createNativeFactIndex(importedRecord).get(matchIndex)
  const runtimeFacts = extractedFacts(
    runtime.extractStaticRecord({
      root,
      record: importedRecord,
      match,
      skipExtractors: nativeFacts?.replacedExtractors,
    }),
  )
  const extracted = [...(nativeFacts?.facts ?? []), ...runtimeFacts]
  return staticFoundDefinitionsFromExtractedFacts(extracted)[0]
}

async function safeReadRecord(
  readRecord: (file: string) => Promise<StaticSyntaxFileRecord>,
  file: string,
): Promise<StaticSyntaxFileRecord | undefined> {
  try {
    return await readRecord(file)
  } catch {
    return undefined
  }
}
