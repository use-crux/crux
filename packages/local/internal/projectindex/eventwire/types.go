package eventwire

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
)

type IndexPatchPhase = model.IndexPatchPhase

const (
	PhaseCache    = model.PhaseCache
	PhaseAST      = model.PhaseAST
	PhaseSemantic = model.PhaseSemantic
	PhaseRuntime  = model.PhaseRuntime
	PhaseQuality  = model.PhaseQuality
)

type IndexPatch = model.IndexPatch
type IndexPatchBudget = model.IndexPatchBudget
type IndexPatchFacts = model.IndexPatchFacts
type IndexFactEnvelope = model.IndexFactEnvelope
type SemanticSourceProfile = model.SemanticSourceProfile
type SemanticSourceProfileFile = model.SemanticSourceProfileFile
type ProjectIndexIncrementalResult = model.ProjectIndexIncrementalResult
type ProjectIndexIncrementalReport = model.ProjectIndexIncrementalReport

func addIndexFactEnvelope(facts *IndexPatchFacts, envelope IndexFactEnvelope) error {
	return model.AddIndexFactEnvelope(facts, envelope)
}

func validatePatchBudget(patch IndexPatch, budget IndexPatchBudget) error {
	return model.ValidatePatchBudget(patch, budget)
}

func sortedUniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	sort.Strings(values)
	out := values[:0]
	var previous string
	for _, value := range values {
		if value == "" || value == previous {
			continue
		}
		out = append(out, value)
		previous = value
	}
	return append([]string(nil), out...)
}
