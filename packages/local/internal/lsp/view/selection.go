package view

import "github.com/use-crux/crux/packages/local/internal/api"

func selectSavedPublication(request ViewRequest, publication Publication) ViewSelection {
	evidence := savedEvidence(publication.Indexing)
	if !evidenceSatisfies(evidence, request.MinimumEvidence) {
		return ViewSelection{Status: ViewStatusUnavailable, Reason: ViewReasonEvidenceInsufficient}
	}

	sources := savedSourceEvidence(publication.SourcesByFile, request)
	reason := savedRelationshipReason(request, publication, sources)
	if reason == ViewReasonNone {
		return savedSelection(request, publication, sources, evidence, ViewStatusExact, ViewReasonNone)
	}
	if request.Freshness == AllowSavedFallback && publication.Revision > 0 {
		return savedSelection(request, publication, sources, evidence, ViewStatusSavedFallback, reason)
	}
	return ViewSelection{Status: ViewStatusUnavailable, Reason: reason}
}

func savedRelationshipReason(
	request ViewRequest,
	publication Publication,
	sources map[string]SourceEvidence,
) ViewSelectionReason {
	if !publication.GenerationKnown {
		return ViewReasonGenerationUnknown
	}
	if request.Document == nil {
		return ViewReasonNone
	}
	source, exists := sources[request.File]
	if !exists || request.Document.SourceHash == "" || source.BaseSourceHash == "" {
		return ViewReasonSourceHashUnknown
	}
	if source.BufferMatch == BufferMatchExact {
		return ViewReasonNone
	}
	return ViewReasonSourceDifferent
}

func savedSelection(
	request ViewRequest,
	publication Publication,
	sources map[string]SourceEvidence,
	evidence EvidenceLevel,
	status ViewStatus,
	reason ViewSelectionReason,
) ViewSelection {
	return ViewSelection{
		Status: status,
		View: &ProjectIndexView{
			Stamp: ViewStamp{
				ScopeID:             request.ScopeID,
				BaseGeneration:      publication.Generation,
				BaseGenerationKnown: publication.GenerationKnown,
				Revision:            publication.Revision,
				Origin:              ViewOriginSaved,
				Evidence:            evidence,
			},
			Publication: publication,
			Sources:     sources,
		},
		Reason: reason,
	}
}

func savedEvidence(indexing *api.ProjectIndexingStatus) EvidenceLevel {
	if indexing != nil && indexing.Semantic.Status == "ready" {
		return EvidenceSemantic
	}
	return EvidenceIndex
}

func evidenceSatisfies(actual, minimum EvidenceLevel) bool {
	return minimum != EvidenceSemantic || actual == EvidenceSemantic
}

func savedSourceEvidence(
	sources map[string]api.IndexSourceFile,
	request ViewRequest,
) map[string]SourceEvidence {
	result := make(map[string]SourceEvidence, len(sources))
	for file, source := range sources {
		match := BufferMatchUnknown
		if file == request.File && request.Document != nil &&
			request.Document.SourceHash != "" && source.SourceHash != "" {
			match = BufferMatchDifferent
			if source.SourceHash == request.Document.SourceHash {
				match = BufferMatchExact
			}
		}
		result[file] = SourceEvidence{
			File: file, Origin: SourceOriginSaved,
			EffectiveSourceHash: source.SourceHash, BaseSourceHash: source.SourceHash,
			BufferMatch: match,
		}
	}
	return result
}
