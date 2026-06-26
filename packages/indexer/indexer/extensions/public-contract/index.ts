/**
 * Public Indexer Extension authoring contracts.
 *
 * This module contains the AST-free types, builders, result helpers, patterns,
 * and relation descriptors that extension authors use to describe facts. Runtime
 * execution, loading, static-record adaptation, and native coverage stay in
 * separate internal boundary modules.
 *
 * @module
 */

export { createDefinitionBuilder, createEmptySourceRefBuilder, createReferenceBuilder } from './builders'
export { facts, none, projectDefinition } from './facts'
export { callPattern, newPattern, patternCallNames } from './patterns'
export { relationSpecFromPolicy, validateRelationSpecs } from './relation-specs'
export type {
  AnalysisTier,
  ArgumentReader,
  ConfigCallReader,
  ConfigReader,
  DefinitionBuilder,
  DefinitionBuilderInput,
  ExtensionIdentity,
  ExtensionReference,
  ExtensionTrustMode,
  ExtensionTrustPolicy,
  ExtractContext,
  ExtractMatch,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  ExtractedSourceRef,
  IndexDependency,
  IndexEmitter,
  IndexExtractor,
  IndexQuery,
  IndexResolver,
  IndexRule,
  IndexRuleContext,
  IndexerCompatibility,
  IndexerExtension,
  IndexerExtensionConfig,
  ReferenceBuilder,
  RelationSpec,
  ResolveContext,
  ResolveResult,
  SemanticReadModel,
  SemanticSymbol,
  SemanticType,
  SourceRefBuilder,
  SourceReference,
  SourceView,
  StaticArgumentReader,
  StaticCallEvidenceQuery,
  StaticCallbackInterest,
  StaticCallbackSummary,
  StaticCallbackSummaryInput,
  StaticCallInterest,
  StaticCallObjectReader,
  StaticConstructorEvidenceQuery,
  StaticConstructorInterest,
  StaticEvidenceCompatibility,
  StaticEvidenceInterestManifest,
  StaticEvidenceInterestSource,
  StaticEvidenceKind,
  StaticEvidenceMode,
  StaticEvidenceReader,
  StaticMatchEvidence,
  StaticObjectMapIdentifierEntry,
  StaticObjectReader,
  UnresolvedReference,
} from './types'

