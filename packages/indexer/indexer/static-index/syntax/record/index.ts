/**
 * Backend-neutral static syntax record boundary.
 *
 * This module is internal to `@crux/indexer`. It defines the Phase 10 logical ABI between parser
 * frontends and the static extraction runtime without exposing parser-native AST objects.
 *
 * @module
 */

export type {
  StaticArrayValue,
  StaticCallSourceMatch,
  StaticCallValue,
  StaticCalleeRecord,
  StaticFunctionCallValue,
  StaticFunctionValue,
  StaticIdentifierValue,
  StaticImportRecord,
  StaticInitializerRecord,
  StaticLiteralValue,
  StaticNewSourceMatch,
  StaticNativeFactProjection,
  StaticObjectProperty,
  StaticObjectSourceMatch,
  StaticObjectValue,
  StaticPropertyAccessValue,
  StaticSourceMatch,
  StaticSourceMatchBase,
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxCallInterest,
  StaticSyntaxConstructorInterest,
  StaticSyntaxFrontend,
  StaticSyntaxFrontendFactory,
  StaticSyntaxFrontendIdentity,
  StaticSyntaxFrontendName,
  StaticSyntaxFrontendOptions,
  StaticSyntaxValue,
  StaticTemplateValue,
  StaticUnsupportedValue,
} from './types'
export { parseStaticFactsFromSyntaxRecords, type StaticRecordFactParseInput } from './file'
export type { NativeFactProjectionMode } from './native-facts'
export {
  createProvidedStaticSyntaxFrontend,
  type ProvidedStaticSyntaxFrontendOptions,
  type ProvidedStaticSyntaxRecordProvider,
} from './provided-frontend'
export { createStaticRecordProjectionCache, type StaticRecordProjectionCache } from './projection-cache'
export { createStaticRecordArgumentReader, createStaticRecordObjectReader } from './readers'
export { createStaticSyntaxInitializerMap, resolveStaticSyntaxValue } from './value'
export { createTypeScriptStaticSyntaxFrontend } from './typescript-frontend'
