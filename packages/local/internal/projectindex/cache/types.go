package cache

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
type IndexPatchFacts = model.IndexPatchFacts
type IndexPatchInvalidation = model.IndexPatchInvalidation
type IndexSourceRefFact = model.IndexSourceRefFact
type IndexFactProducer = model.IndexFactProducer
type IndexFactProvenance = model.IndexFactProvenance
type IndexFactEnvelope = model.IndexFactEnvelope
type IndexFactTransaction = model.IndexFactTransaction

var EmptyPatchState = model.EmptyPatchState
var ApplyPatch = model.ApplyPatch
var FactTransactionFromPatch = model.FactTransactionFromPatch

func indexPatchFactsFromEnvelopes(envelopes []IndexFactEnvelope) (IndexPatchFacts, error) {
	return model.IndexPatchFactsFromEnvelopes(envelopes)
}

func decodeIndexFact[T any](envelope IndexFactEnvelope, out *T) error {
	return model.DecodeIndexFact(envelope, out)
}

func validateIndexFactFidelity(envelope IndexFactEnvelope) error {
	return model.ValidateIndexFactFidelity(envelope)
}

func validateIndexFactProvenance(envelope IndexFactEnvelope) error {
	return model.ValidateIndexFactProvenance(envelope)
}
