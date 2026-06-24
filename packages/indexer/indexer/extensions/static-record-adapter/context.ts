import { safeId } from '../../definitions'
import { staticDefinition } from '../../static/definition-builder'
import { createStaticRecordArgumentReader, createStaticRecordObjectReader } from '../../static/syntax-record/readers'
import type {
  StaticInitializerRecord,
  StaticObjectValue,
  StaticSourceMatch,
  StaticSyntaxFileRecord,
} from '../../static/syntax-record/types'
import type { StaticSyntaxInitializerMap } from '../../static/syntax-record/value'
import { createDefinitionBuilder, createReferenceBuilder } from '../public-contract/builders'
import { createStaticRecordSyntaxHandle } from './native-context'
import { createStaticRecordSourceRefBuilder } from './source-ref'
import type { ExtractContext, IndexExtractor, IndexerExtension } from '../public-contract/types'

/** Input required to build one record-backed extractor context. */
export interface StaticRecordExtractContextInput {
  /** Project root used for deterministic local ids. */
  readonly root: string
  /** Syntax record that owns the source match. */
  readonly record: StaticSyntaxFileRecord
  /** Source match selected by registry dispatch. */
  readonly match: StaticSourceMatch
  /** Config object selected for the running extractor pattern. */
  readonly objectArg?: StaticObjectValue
  /** Source-local initializer lookup for conservative alias resolution. */
  readonly initializers: StaticSyntaxInitializerMap
  /** Source-local initializer records visible at the current match. */
  readonly initializerRecords: readonly StaticInitializerRecord[]
  /** Extension that owns the running extractor. */
  readonly extension: IndexerExtension
  /** Extractor being invoked. */
  readonly extractor: IndexExtractor
  /** Already parsed syntax records keyed by absolute file path for direct import source refs. */
  readonly recordsByFile?: ReadonlyMap<string, StaticSyntaxFileRecord>
}

/**
 * Adapts backend-neutral syntax records into the stable extractor context.
 *
 * The returned context only carries normalized syntax records in `internalNative`: record-backed
 * execution must be usable by any parser frontend and cannot expose TypeScript or Oxc parser objects
 * to extension code.
 */
export function createStaticRecordExtractContext(input: StaticRecordExtractContextInput): ExtractContext {
  const args = input.match.kind === 'object' ? [] : input.match.args
  return {
    extension: { name: input.extension.name, version: input.extension.version },
    extractor: input.extractor.name,
    match: { kind: input.match.kind, name: matchName(input.match) },
    source: {
      root: input.root,
      file: input.record.file,
      variableName: input.match.variableName,
      localName: input.match.localName,
      safeId,
    },
    args: createStaticRecordArgumentReader(args, input.initializers),
    config: input.objectArg ? createStaticRecordObjectReader(input.objectArg, input.initializers) : undefined,
    define: createDefinitionBuilder(({ id, kind, name, metadata }) =>
      staticDefinition(input.record.file, id, kind, name, undefined, input.match.source, input.match.snippet, metadata),
    ),
    ref: createReferenceBuilder(),
    sourceRef: createStaticRecordSourceRefBuilder({
      record: input.record,
      ...(input.objectArg ? { object: input.objectArg } : {}),
      initializers: input.initializerRecords,
      ...(input.recordsByFile ? { recordsByFile: input.recordsByFile } : {}),
    }),
    internalNative: createStaticRecordSyntaxHandle({
      root: input.root,
      record: input.record,
      match: input.match,
      initializers: input.initializers,
      initializerRecords: input.initializerRecords,
      ...(input.recordsByFile ? { recordsByFile: input.recordsByFile } : {}),
      ...(input.objectArg ? { objectArg: input.objectArg } : {}),
    }),
  }
}

function matchName(match: StaticSourceMatch): string {
  return match.kind === 'object' ? 'object' : match.callee.name
}
