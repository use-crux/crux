/**
 * Native semantic direct projector manifests and guarded fast paths.
 *
 * Direct projectors are optimizations for first-party source shapes. The
 * manifest describes supported call names, identity fields, source refs, and
 * relations so native behavior stays auditable against the TypeScript baseline.
 *
 * @module
 */

export {
  nativeDirectPrimitiveManifest,
  type NativeDirectArrayDependencySpec,
  type NativeDirectDefinitionKind,
  type NativeDirectDependencyFactSpec,
  type NativeDirectDependencySpec,
  type NativeDirectIdentifierDependencySpec,
  type NativeDirectObjectDependencySpec,
  type NativeDirectPrimitiveSpec,
  type NativeDirectRelationOriginSpec,
  type NativeDirectSchemaMetadataKey,
  type NativeDirectSchemaSpec,
  type NativeDirectSourceRefSpec,
  type NativeDirectStaticIdArrayDependencySpec,
} from './manifest'
export { nativeDirectAgentPrimitiveManifest } from './agent-manifest'
export { nativeDirectRoutingPrimitiveManifest } from './routing-manifest'
export {
  isNativeDirectCandidate,
  nativeDirectCandidateFiles,
  nativeDirectEvidence,
  nativeDirectEvidenceForFiles,
  type NativeDirectEvidenceResult,
} from './evidence'
