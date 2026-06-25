/**
 * Static Syntax record adapter for extension execution.
 *
 * This module converts backend-neutral syntax records into extension contexts,
 * source references, and normalized static facts. It is an internal adapter
 * boundary between parser evidence and the extension runtime.
 *
 * @module
 */

export { createStaticExtensionRegistry, createStaticExtractContextForTesting, extractFactsWithExtensionRegistry } from './adapter'
export { staticFoundDefinitionFromExtractedFacts, staticFoundDefinitionsFromExtractedFacts } from './normalizer'
export { extractStaticRecordWithRegistry, type StaticRecordExtractionInput } from './runtime'
export { createStaticRecordExtractContext } from './context'
export { createStaticRecordSourceRefBuilder } from './source-ref'
export { staticRecordDataAccessRefsFromValue } from './record-data-access'
export { schemaPropertySourceRefs } from './schema-source-ref'
export {
  createStaticRecordSourceResolver,
  resolvedRecordObjectProperty,
  staticRecordProjectSourceRef,
  type ResolvedStaticRecordSource,
  type StaticRecordSourceResolverInput,
} from './source-resolver'
export {
  createNativeSyntaxHandle,
  createStaticRecordSyntaxHandle,
  internalStaticCallContext,
  internalStaticRecordContext,
  internalTypeScriptContext,
  type InternalStaticRecordContext,
  type NativeSyntaxHandle,
} from './native-context'
export {
  internalAuthoredMemoryId,
  internalIdentifierRefsForConfigProperty,
  internalObjectMapIdentifierEntries,
} from './config'
export { internalDataAccessRefsForConfigProperties } from './data-access'
export { internalFlowTraversal } from './flow-traversal'
export {
  internalCascadeTierDefinitions,
  internalFallbackOptionDefinitions,
  internalFallbackOptions,
  internalRouterRouteDefinitions,
  internalRoutingArrayProperty,
  internalRoutingModelPreview,
  internalRoutingObjectLiteralMetadata,
  internalRoutingObjectProperty,
  internalRoutingPropertyInitializer,
} from './routing-traversal'
export {
  internalStaticTraversal,
  type CallPredicate,
  type InternalStaticTraversal,
  type StaticCallMatch,
} from './traversal'
