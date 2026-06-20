import type { SourceFile } from '@typescript/native-preview/unstable/ast'
import type { NativeDefinition, NativeVariable } from './tsgo-native-direct-types'

export type NativeVariableScope = ReadonlyMap<SourceFile, ReadonlyMap<string, NativeVariable>>
export type NativeDefinitionScope = ReadonlyMap<SourceFile, ReadonlyMap<string, NativeDefinition>>

/** Builds source-file-local variable lookup tables for native direct evidence. */
export function nativeVariableMapsByFile(
  sources: readonly SourceFile[],
  variableGroups: readonly (readonly NativeVariable[])[],
): NativeVariableScope {
  return new Map(
    sources.map((source, index) => [
      source,
      new Map((variableGroups[index] ?? []).map((variable) => [variable.name, variable])),
    ]),
  )
}

/** Builds source-file-local definition lookup tables for direct dependency resolution. */
export function nativeDefinitionMapsByFile(
  sources: readonly SourceFile[],
  definitions: readonly NativeDefinition[],
): NativeDefinitionScope {
  return new Map(
    sources.map((source) => [
      source,
      new Map(
        definitions
          .filter((definition) => definition.variable.file === source)
          .map((definition) => [definition.variable.name, definition]),
      ),
    ]),
  )
}
