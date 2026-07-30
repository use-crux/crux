package preview

import "sort"

// Candidate is the minimal in-memory peer identity used during selection.
type Candidate struct {
	PeerID      string
	RuntimeName string
	Environment string
	Capability  *Capability
}

// Select applies the binding zero-match precedence and ambiguity rule.
func Select(candidates []Candidate, peerID, environment, targetID string, revision uint64) (Candidate, error) {
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].PeerID < candidates[j].PeerID
	})
	if len(candidates) == 0 {
		return Candidate{}, NewFailure("no_peer")
	}
	selected := candidates
	if peerID != "" {
		selected = filter(selected, func(candidate Candidate) bool {
			return candidate.PeerID == peerID
		})
		if len(selected) == 0 {
			return Candidate{}, NewFailure("no_peer")
		}
	}
	if environment != "" {
		selected = filter(selected, func(candidate Candidate) bool {
			return candidate.Environment == environment
		})
		if len(selected) == 0 {
			return Candidate{}, NewFailure("environment_unavailable")
		}
	}
	selected = filter(selected, func(candidate Candidate) bool {
		return candidate.Capability != nil
	})
	if len(selected) == 0 {
		return Candidate{}, NewFailure("capability_unavailable")
	}
	selected = filter(selected, func(candidate Candidate) bool {
		return hasTarget(candidate.Capability, targetID)
	})
	if len(selected) == 0 {
		return Candidate{}, NewFailure("target_unavailable")
	}
	selected = filter(selected, func(candidate Candidate) bool {
		return candidate.Capability.CatalogueRevision == revision
	})
	if len(selected) == 0 {
		return Candidate{}, NewFailure("catalogue_changed")
	}
	if len(selected) > 1 {
		choices := make([]PeerChoice, len(selected))
		for i, candidate := range selected {
			choices[i] = PeerChoice{
				PeerID: candidate.PeerID, RuntimeName: candidate.RuntimeName,
				Environment: candidate.Environment,
			}
		}
		failure := NewFailure("ambiguous_peer")
		failure.Choices = choices
		return Candidate{}, failure
	}
	return selected[0], nil
}

func hasTarget(capability *Capability, targetID string) bool {
	if capability == nil {
		return false
	}
	index := sort.Search(len(capability.Targets), func(i int) bool {
		return capability.Targets[i].DefinitionID >= targetID
	})
	return index < len(capability.Targets) &&
		capability.Targets[index].DefinitionID == targetID
}

func filter(values []Candidate, keep func(Candidate) bool) []Candidate {
	out := make([]Candidate, 0, len(values))
	for _, value := range values {
		if keep(value) {
			out = append(out, value)
		}
	}
	return out
}
