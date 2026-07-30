package view

import "github.com/use-crux/crux/packages/local/internal/lsp/readmodel"

// SavedProvider captures one detached saved publication from Store for every
// request. It never mirrors, mutates, or replaces Store state.
type SavedProvider struct {
	store *readmodel.Store
}

// NewSavedProvider creates a request-relative provider over the session Store.
//
// The provider captures generation, revision, evidence, facts, diagnostics,
// findings, and source rows under the Store's single publication read lock.
// The supplied Store remains the only saved authority, and the returned
// provider is safe for concurrent feature requests.
func NewSavedProvider(store *readmodel.Store) *SavedProvider {
	return &SavedProvider{store: store}
}

// BestAvailableView atomically captures and selects saved evidence for request.
// It returns a detached exact or fallback view, or an unavailable selection.
func (p *SavedProvider) BestAvailableView(request ViewRequest) ViewSelection {
	if p == nil || p.store == nil {
		return ViewSelection{Status: ViewStatusUnavailable, Reason: ViewReasonGenerationUnknown}
	}
	return selectSavedPublication(request, p.store.PublicationSnapshot(request.ScopeID))
}

// Current reports whether stamp still identifies the Store's complete saved
// publication. It compares the canonical stamp instead of generation alone.
func (p *SavedProvider) Current(stamp ViewStamp) bool {
	if p == nil || p.store == nil || stamp.Origin != ViewOriginSaved ||
		stamp.OverlayRevision != 0 {
		return false
	}
	publication := p.store.PublicationSnapshot(stamp.ScopeID)
	return publication.Generation == stamp.BaseGeneration &&
		publication.GenerationKnown == stamp.BaseGenerationKnown &&
		publication.Revision == stamp.Revision &&
		savedEvidence(publication.Indexing) == stamp.Evidence
}
