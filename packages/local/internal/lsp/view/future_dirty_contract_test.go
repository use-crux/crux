package view

import "testing"

func TestFutureDirtyProviderRequiresEveryApprovedMatchDimension(t *testing.T) {
	t.Parallel()

	request := dirtyContractRequest()
	valid := newDirtyContractProvider(t)
	exact := valid.BestAvailableView(request)
	if exact.Status != ViewStatusExact || exact.View == nil ||
		exact.View.Stamp.Origin != ViewOriginDirtyOverlay ||
		exact.View.Sources[request.File].Document == nil {
		t.Fatalf("valid dirty selection = %#v, want exact dirty overlay", exact)
	}

	tests := []struct {
		name   string
		mutate func(*dirtyContractProvider)
	}{
		{"session", func(p *dirtyContractProvider) { p.candidate.sessionID = "other" }},
		{"scope", func(p *dirtyContractProvider) { p.candidate.scopeID = "other" }},
		{"base generation", func(p *dirtyContractProvider) { p.candidate.baseGeneration++ }},
		{"source profile", func(p *dirtyContractProvider) { p.candidate.sourceProfile = "other" }},
		{"open epoch", func(p *dirtyContractProvider) {
			revision := p.candidate.documents["/repo/dependency.ts"]
			revision.OpenEpoch++
			p.candidate.documents["/repo/dependency.ts"] = revision
		}},
		{"document version", func(p *dirtyContractProvider) {
			revision := p.candidate.documents["/repo/dependency.ts"]
			revision.Version++
			p.candidate.documents["/repo/dependency.ts"] = revision
		}},
		{"document hash", func(p *dirtyContractProvider) {
			revision := p.candidate.documents["/repo/dependency.ts"]
			revision.SourceHash = "other"
			p.candidate.documents["/repo/dependency.ts"] = revision
		}},
		{"evidence", func(p *dirtyContractProvider) { p.candidate.evidence = EvidenceIndex }},
		{"overlay revision", func(p *dirtyContractProvider) { p.candidate.overlayRevision++ }},
		{"incomplete", func(p *dirtyContractProvider) { p.candidate.complete = false }},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			provider := newDirtyContractProvider(t)
			test.mutate(provider)
			assertSavedFallback(t, provider.BestAvailableView(request))
		})
	}
}

func TestFutureDirtyProviderCanSatisfyRequireCurrent(t *testing.T) {
	t.Parallel()

	request := dirtyContractRequest()
	request.Freshness = RequireCurrent
	selection := newDirtyContractProvider(t).BestAvailableView(request)
	if selection.Status != ViewStatusExact || selection.View == nil ||
		selection.View.Stamp.Origin != ViewOriginDirtyOverlay {
		t.Fatalf("selection = %#v, want exact dirty view", selection)
	}
}

func TestFutureDirtyProviderNeverFallsBackToSupersededDirtyResult(t *testing.T) {
	t.Parallel()

	provider := newDirtyContractProvider(t)
	request := dirtyContractRequest()
	request.Document = &DocumentRevision{
		OpenEpoch:  request.Document.OpenEpoch,
		Version:    request.Document.Version + 1,
		SourceHash: "newer-dirty",
	}
	provider.documents[request.File] = *request.Document

	assertSavedFallback(t, provider.BestAvailableView(request))
}

func TestFutureDirtyProviderLifecycleEventsRetireCandidates(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		retire func(*dirtyContractProvider)
	}{
		{"didChange", (*dirtyContractProvider).didChange},
		{"didSave", (*dirtyContractProvider).didSave},
		{"didClose", (*dirtyContractProvider).didClose},
		{"generation advance", (*dirtyContractProvider).generationAdvance},
		{"handover", (*dirtyContractProvider).handover},
		{"reconnect", (*dirtyContractProvider).reconnect},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			provider := newDirtyContractProvider(t)
			test.retire(provider)
			assertSavedFallback(t, provider.BestAvailableView(dirtyContractRequest()))
		})
	}
}

func newDirtyContractProvider(t *testing.T) *dirtyContractProvider {
	t.Helper()

	documents := map[string]DocumentRevision{
		"/repo/writer.ts":     {OpenEpoch: 2, Version: 7, SourceHash: "dirty-writer"},
		"/repo/dependency.ts": {OpenEpoch: 1, Version: 3, SourceHash: "dirty-dependency"},
	}
	candidateDocuments := make(map[string]DocumentRevision, len(documents))
	for file, revision := range documents {
		candidateDocuments[file] = revision
	}
	return &dirtyContractProvider{
		saved:     savedSelectionFixture("ready", generationPointer(4), "saved"),
		sessionID: "session", sourceProfile: "profile-v1", overlayRevision: 5,
		documents: documents,
		candidate: dirtyContractCandidate{
			sessionID: "session", scopeID: "scope", baseGeneration: 4,
			sourceProfile: "profile-v1", overlayRevision: 5, revision: 9,
			evidence: EvidenceSemantic, complete: true, documents: candidateDocuments,
		},
	}
}

func dirtyContractRequest() ViewRequest {
	document := DocumentRevision{OpenEpoch: 2, Version: 7, SourceHash: "dirty-writer"}
	return ViewRequest{
		ScopeID: "scope", File: "/repo/writer.ts", Document: &document,
		MinimumEvidence: EvidenceSemantic, Freshness: AllowSavedFallback,
	}
}

func assertSavedFallback(t *testing.T, selection ViewSelection) {
	t.Helper()
	if selection.Status != ViewStatusSavedFallback || selection.View == nil ||
		selection.View.Stamp.Origin != ViewOriginSaved {
		t.Fatalf("selection = %#v, want saved fallback", selection)
	}
}
