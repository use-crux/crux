import type { ProjectDefinition, ProjectDefinitionKind } from '@crux/core/project-index'
import type { IndexerExtensionRuntime } from '../../extensions'
import { staticFoundDefinitionsFromExtractedFacts } from '../../extensions/static-normalizer'
import type { StaticFoundDefinition } from '../../types'
import type { StaticSyntaxFileRecord, StaticSyntaxValue } from './types'
import { createNativeFactIndex, extractedFacts } from './native-facts'

/** Runtime inputs for record-backed prompt/context tree path projection. */
export interface StaticRecordTreePathInput {
  /** Project root used by extractor runtime calls. */
  readonly root: string
  /** Source record that owns the authored tree calls. */
  readonly record: StaticSyntaxFileRecord
  /** Runtime used to extract imported tree leaf definitions through the same extension contract. */
  readonly runtime: IndexerExtensionRuntime
  /** Definitions already discovered from this source file, keyed by authored variable names. */
  readonly found: readonly StaticFoundDefinition[]
  /** Reads a syntax record for an imported source file. */
  readonly readRecord: (file: string) => Promise<StaticSyntaxFileRecord>
}

/**
 * Projects `createPrompts` and `createContexts` object trees from syntax records.
 *
 * The projection intentionally consumes the compact record ABI instead of parser-native AST nodes.
 * Only identifier leaves are resolved, matching the conservative TypeScript projection semantics.
 */
export async function staticRecordTreePathDefinitions(input: StaticRecordTreePathInput): Promise<ProjectDefinition[]> {
  const definitions: ProjectDefinition[] = []
  const localByVariable = new Map(input.found.map((item) => [item.variableName, item.definition]))

  for (const tree of treeContainers(input.record)) {
    definitions.push(
      ...(await treePathDefinitionsForObject({
        input,
        object: tree.object,
        path: [],
        kind: tree.kind,
        localByVariable,
      })),
    )
  }

  return definitions
}

interface TreeContainer {
  readonly kind: Extract<ProjectDefinitionKind, 'prompt' | 'context'>
  readonly object: Extract<StaticSyntaxValue, { readonly kind: 'object' }>
}

function treeContainers(record: StaticSyntaxFileRecord): readonly TreeContainer[] {
  return record.localInitializers.flatMap((initializer) => treeContainerFromValue(initializer.value))
}

function treeContainerFromValue(value: StaticSyntaxValue): readonly TreeContainer[] {
  if (value.kind !== 'call') return []
  const kind = treeKindForCall(value.callee.name)
  const firstArg = value.args[0]
  if (!kind || firstArg?.kind !== 'object') return []
  return [{ kind, object: firstArg }]
}

async function treePathDefinitionsForObject(input: {
  readonly input: StaticRecordTreePathInput
  readonly object: Extract<StaticSyntaxValue, { readonly kind: 'object' }>
  readonly path: readonly string[]
  readonly kind: Extract<ProjectDefinitionKind, 'prompt' | 'context'>
  readonly localByVariable: ReadonlyMap<string, ProjectDefinition>
}): Promise<ProjectDefinition[]> {
  const definitions: ProjectDefinition[] = []
  for (const property of input.object.properties) {
    if (property.spread) continue
    const nextPath = [...input.path, property.name]
    if (property.value.kind === 'object') {
      definitions.push(
        ...(await treePathDefinitionsForObject({
          ...input,
          object: property.value,
          path: nextPath,
        })),
      )
      continue
    }
    if (property.value.kind !== 'identifier') continue

    const resolved = await resolveTreeLeafDefinition({
      input: input.input,
      localByVariable: input.localByVariable,
      identifier: property.value.name,
      kind: input.kind,
    })
    if (!resolved) continue
    definitions.push({
      id: resolved.id,
      kind: resolved.kind,
      name: resolved.name,
      path: nextPath,
      fidelity: resolved.fidelity,
      status: resolved.status,
    })
  }
  return definitions
}

async function resolveTreeLeafDefinition(input: {
  readonly input: StaticRecordTreePathInput
  readonly localByVariable: ReadonlyMap<string, ProjectDefinition>
  readonly identifier: string
  readonly kind: ProjectDefinitionKind
}): Promise<ProjectDefinition | undefined> {
  const local = input.localByVariable.get(input.identifier)
  if (local?.kind === input.kind) return local

  const importRecord = input.input.record.imports.find((item) => item.localName === input.identifier)
  if (!importRecord?.resolvedFile || importRecord.importedName === 'default') return undefined
  const exported = await staticExportDefinitions(input.input, importRecord.resolvedFile)
  const imported = exported.get(importRecord.importedName)
  return imported?.kind === input.kind ? imported : undefined
}

async function staticExportDefinitions(
  input: StaticRecordTreePathInput,
  file: string,
): Promise<Map<string, ProjectDefinition>> {
  const record = await safeReadRecord(input.readRecord, file)
  if (!record) return new Map()
  const definitions = new Map<string, ProjectDefinition>()
  const nativeFactsByMatchIndex = createNativeFactIndex(record)

  for (const [matchIndex, match] of record.matches.entries()) {
    if (!match.exported) continue
    const nativeFacts = nativeFactsByMatchIndex.get(matchIndex)
    const extracted = [
      ...(nativeFacts?.facts ?? []),
      ...extractedFacts(
        input.runtime.extractStaticRecord({
          root: input.root,
          record,
          match,
          skipExtractors: nativeFacts?.replacedExtractors,
        }),
      ),
    ]
    for (const found of staticFoundDefinitionsFromExtractedFacts(extracted)) {
      definitions.set(found.variableName, found.definition)
    }
  }

  return definitions
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

function treeKindForCall(name: string): Extract<ProjectDefinitionKind, 'prompt' | 'context'> | undefined {
  if (name === 'createPrompts') return 'prompt'
  if (name === 'createContexts') return 'context'
  return undefined
}
