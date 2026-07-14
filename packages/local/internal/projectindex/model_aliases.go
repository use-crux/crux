package projectindex

import "github.com/use-crux/crux/packages/local/internal/projectindex/model"

type IndexPatchPhase = model.IndexPatchPhase

const (
	PhaseCache    = model.PhaseCache
	PhaseAST      = model.PhaseAST
	PhaseSemantic = model.PhaseSemantic
	PhaseRuntime  = model.PhaseRuntime
	PhaseQuality  = model.PhaseQuality
)

type IndexPatch = model.IndexPatch
type SemanticSourceProfile = model.SemanticSourceProfile
type SemanticSourceProfileFile = model.SemanticSourceProfileFile
type SemanticSourceProfileHints = model.SemanticSourceProfileHints
type IndexPatchInvalidation = model.IndexPatchInvalidation
type IndexPatchFacts = model.IndexPatchFacts
type IndexPatchBudget = model.IndexPatchBudget
type IndexSourceRefFact = model.IndexSourceRefFact
type PatchState = model.PatchState

type IndexFactProducer = model.IndexFactProducer
type IndexFactProvenance = model.IndexFactProvenance
type IndexFactEnvelope = model.IndexFactEnvelope
type IndexFactTransaction = model.IndexFactTransaction

type ProjectIndexIncrementalResult = model.ProjectIndexIncrementalResult
type ProjectIndexIncrementalReport = model.ProjectIndexIncrementalReport
type ProjectIndexPatchCounts = model.ProjectIndexPatchCounts

type Generation = model.Generation
type State = model.State
type StateCheckpoint = model.StateCheckpoint
type RuntimeUpdateOperation = model.RuntimeUpdateOperation
type RuntimeUpdateOwner = model.RuntimeUpdateOwner
type RuntimeUpdateError = model.RuntimeUpdateError
type ProjectIndexRuntimeUpdate = model.ProjectIndexRuntimeUpdate
type RuntimeOverlay = model.RuntimeOverlay
type RuntimeOverlayState = model.RuntimeOverlayState
type RuntimeUpdateConflictError = model.RuntimeUpdateConflictError
type RuntimeUpdateValidationError = model.RuntimeUpdateValidationError
type RuntimeUpdatePersistenceError = model.RuntimeUpdatePersistenceError

const (
	RuntimeUpdateReplace = model.RuntimeUpdateReplace
	RuntimeUpdateFailure = model.RuntimeUpdateFailure
)

type ProjectStaticSyntaxPlan = model.ProjectStaticSyntaxPlan
type StaticCallInterest = model.StaticCallInterest
type StaticConstructorInterest = model.StaticConstructorInterest
type StaticCallbackInterest = model.StaticCallbackInterest
type StaticCacheHit = model.StaticCacheHit
type SyntaxFrontend = model.SyntaxFrontend

type ProjectStaticIndexConfig = model.ProjectStaticIndexConfig
type ProjectStaticIndexExtensionReference = model.ProjectStaticIndexExtensionReference
type ProjectStaticIndexConfigDiagnostic = model.ProjectStaticIndexConfigDiagnostic

type StaticExtensionHostManifestResult = model.StaticExtensionHostManifestResult
type StaticExtensionRuntimeManifest = model.StaticExtensionRuntimeManifest
type StaticExtensionHostNodeReport = model.StaticExtensionHostNodeReport

var EmptyPatchState = model.EmptyPatchState
var NewState = model.NewState
var NewRuntimeOverlayState = model.NewRuntimeOverlayState
var ValidateRuntimeUpdate = model.ValidateRuntimeUpdate
var ValidateRuntimeUpdateAgainstBase = model.ValidateRuntimeUpdateAgainstBase
var IsRuntimeUpdateConflict = model.IsRuntimeUpdateConflict
var NewRuntimeUpdateValidationError = model.NewRuntimeUpdateValidationError
var IsRuntimeUpdateValidationError = model.IsRuntimeUpdateValidationError
var NewRuntimeUpdatePersistenceError = model.NewRuntimeUpdatePersistenceError
var IsRuntimeUpdatePersistenceError = model.IsRuntimeUpdatePersistenceError
var ApplyPatch = model.ApplyPatch
var PatchFromSnapshot = model.PatchFromSnapshot
var MergeIndexPatches = model.MergeIndexPatches
var ValidatePatchBudget = model.ValidatePatchBudget
var RelationMergeKey = model.RelationMergeKey
var FactTransactionFromPatch = model.FactTransactionFromPatch
var MergeProjectDefinition = model.MergeProjectDefinition
var HasCompleteShardEvidence = model.HasCompleteShardEvidence
var JoinSemanticPatch = model.JoinSemanticPatch
var MergeRuntimeSnapshot = model.MergeRuntimeSnapshot
var ProjectRegisteredRuntimeSnapshot = model.ProjectRegisteredRuntimeSnapshot
var IsEmptyIndex = model.IsEmptyIndex
var IsSourceOnlyIndex = model.IsSourceOnlyIndex
var HasSourceOnlyDiagnostic = model.HasSourceOnlyDiagnostic
var FilterRuntimeDiagnostics = model.FilterRuntimeDiagnostics
