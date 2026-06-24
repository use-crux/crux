export type {
  StaticCallbackInterest,
  StaticCallbackSummary,
  StaticCallbackSummaryInput,
  StaticCallEvidenceQuery,
  StaticCallInterest,
  StaticConstructorEvidenceQuery,
  StaticConstructorInterest,
  StaticEvidenceInterestManifest,
  StaticEvidenceInterestSource,
  StaticEvidenceCompatibility,
  StaticEvidenceKind,
  StaticEvidenceMode,
  StaticEvidenceReader,
  StaticMatchEvidence,
} from '../static-evidence/types'
export type {
  AnalysisTier,
  ExtensionIdentity,
  ExtensionReference,
  ExtensionTrustMode,
  ExtensionTrustPolicy,
  IndexerCompatibility,
  IndexerExtension,
  IndexerExtensionConfig,
  SemanticReadModel,
  SemanticSymbol,
  SemanticType,
  SourceReference,
} from './manifest-types'
export type {
  ExtractContext,
  ExtractMatch,
  ExtractPattern,
  ExtractResult,
  ExtractedDefinition,
  ExtractedFacts,
  ExtractedSourceRef,
  IndexDependency,
  IndexExtractor,
  SourceView,
  UnresolvedReference,
} from './extractor-types'
export type {
  IndexEmitter,
  IndexQuery,
  IndexResolver,
  IndexRule,
  IndexRuleContext,
  RelationSpec,
  ResolveContext,
  ResolveResult,
} from './resolver-rule-types'

/**
 * Stable object-literal reader exposed to static extractors.
 *
 * Readers project TypeScript syntax into conservative literal data: strings, numbers, booleans,
 * identifiers, object readers, arrays, JSON-safe values, and schema projections. When a property cannot
 * be represented safely, methods return `undefined` or an empty array instead of exposing raw AST nodes.
 */

export type {
  ArgumentReader,
  ConfigCallReader,
  ConfigReader,
  DefinitionBuilder,
  DefinitionBuilderInput,
  ReferenceBuilder,
  SourceRefBuilder,
  StaticArgumentReader,
  StaticCallObjectReader,
  StaticObjectMapIdentifierEntry,
  StaticObjectReader,
} from './authoring-types'
