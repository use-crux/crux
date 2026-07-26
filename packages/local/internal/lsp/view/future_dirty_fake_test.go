package view

type dirtyContractCandidate struct {
	sessionID       string
	scopeID         string
	baseGeneration  uint64
	sourceProfile   string
	overlayRevision uint64
	revision        uint64
	evidence        EvidenceLevel
	complete        bool
	documents       map[string]DocumentRevision
}

type dirtyContractProvider struct {
	saved           ViewProvider
	sessionID       string
	sourceProfile   string
	overlayRevision uint64
	documents       map[string]DocumentRevision
	candidate       dirtyContractCandidate
	retired         bool
}

func (p *dirtyContractProvider) BestAvailableView(request ViewRequest) ViewSelection {
	fallback := p.saved.BestAvailableView(request)
	baseRequest := request
	baseRequest.Freshness = AllowSavedFallback
	base := p.saved.BestAvailableView(baseRequest)
	if !p.candidateMatches(request, base) {
		return fallback
	}

	saved := base.View
	sources := make(map[string]SourceEvidence, len(saved.Sources))
	for file, source := range saved.Sources {
		sources[file] = source
	}
	for file, revision := range p.candidate.documents {
		baseSourceHash := ""
		if source, ok := sources[file]; ok {
			baseSourceHash = source.BaseSourceHash
		}
		document := revision
		match := BufferMatchUnknown
		if file == request.File {
			match = BufferMatchExact
		}
		sources[file] = SourceEvidence{
			File: file, Origin: SourceOriginDirty,
			EffectiveSourceHash: revision.SourceHash, BaseSourceHash: baseSourceHash,
			Document: &document, BufferMatch: match,
		}
	}
	return ViewSelection{
		Status: ViewStatusExact,
		View: &ProjectIndexView{
			Stamp: ViewStamp{
				ScopeID:        request.ScopeID,
				BaseGeneration: saved.Stamp.BaseGeneration, BaseGenerationKnown: true,
				Revision: p.candidate.revision, OverlayRevision: p.candidate.overlayRevision,
				Origin: ViewOriginDirtyOverlay, Evidence: p.candidate.evidence,
			},
			Publication: saved.Publication,
			Sources:     sources,
		},
	}
}

func (p *dirtyContractProvider) candidateMatches(
	request ViewRequest,
	saved ViewSelection,
) bool {
	candidate := p.candidate
	if p.retired || !candidate.complete || saved.View == nil ||
		candidate.sessionID != p.sessionID ||
		candidate.scopeID != request.ScopeID ||
		candidate.baseGeneration != saved.View.Stamp.BaseGeneration ||
		!saved.View.Stamp.BaseGenerationKnown ||
		candidate.sourceProfile != p.sourceProfile ||
		candidate.overlayRevision != p.overlayRevision ||
		!evidenceSatisfies(candidate.evidence, request.MinimumEvidence) ||
		!documentSetsMatch(candidate.documents, p.documents) {
		return false
	}
	if request.Document == nil {
		return true
	}
	document, ok := candidate.documents[request.File]
	return ok && document == *request.Document
}

func documentSetsMatch(left, right map[string]DocumentRevision) bool {
	if len(left) != len(right) {
		return false
	}
	for file, revision := range left {
		if right[file] != revision {
			return false
		}
	}
	return true
}

func (p *dirtyContractProvider) didChange()         { p.retired = true }
func (p *dirtyContractProvider) didSave()           { p.retired = true }
func (p *dirtyContractProvider) didClose()          { p.retired = true }
func (p *dirtyContractProvider) generationAdvance() { p.retired = true }
func (p *dirtyContractProvider) handover()          { p.retired = true }
func (p *dirtyContractProvider) reconnect()         { p.retired = true }
