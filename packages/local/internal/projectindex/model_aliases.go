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
var IsEmptyIndex = model.IsEmptyIndex
var IsSourceOnlyIndex = model.IsSourceOnlyIndex
var HasSourceOnlyDiagnostic = model.HasSourceOnlyDiagnostic
var FilterRuntimeDiagnostics = model.FilterRuntimeDiagnostics
