package view

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestSavedProviderSelectsMatchingSemanticPublicationAsExact(t *testing.T) {
	t.Parallel()

	const (
		scope      = "scope"
		file       = "/repo/writer.ts"
		sourceHash = "saved-hash"
	)
	generation := uint64(7)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: sourceHash,
		}},
	})

	selection := NewSavedProvider(store).BestAvailableView(ViewRequest{
		ScopeID: scope,
		File:    file,
		Document: &DocumentRevision{
			OpenEpoch: 2, Version: 11, SourceHash: sourceHash,
		},
		MinimumEvidence: EvidenceSemantic,
		Freshness:       RequireCurrent,
	})

	if selection.Status != ViewStatusExact || selection.Reason != ViewReasonNone || selection.View == nil {
		t.Fatalf("selection = %#v, want exact saved view", selection)
	}
	if stamp := selection.View.Stamp; stamp.ScopeID != scope ||
		!stamp.BaseGenerationKnown || stamp.BaseGeneration != generation ||
		stamp.Revision != 1 || stamp.OverlayRevision != 0 ||
		stamp.Origin != ViewOriginSaved || stamp.Evidence != EvidenceSemantic {
		t.Fatalf("stamp = %#v, want exact semantic saved identity", stamp)
	}
	source := selection.View.Sources[file]
	if source.File != file || source.Origin != SourceOriginSaved ||
		source.EffectiveSourceHash != sourceHash || source.BaseSourceHash != sourceHash ||
		source.Document != nil || source.BufferMatch != BufferMatchExact {
		t.Fatalf("source evidence = %#v, want matching saved evidence", source)
	}
}

func TestSavedProviderRejectsDifferentBytesWhenCurrentIsRequired(t *testing.T) {
	t.Parallel()

	provider := semanticSavedProvider(t, "saved-hash")
	selection := provider.BestAvailableView(ViewRequest{
		ScopeID: "scope",
		File:    "/repo/writer.ts",
		Document: &DocumentRevision{
			OpenEpoch: 1, Version: 2, SourceHash: "dirty-hash",
		},
		MinimumEvidence: EvidenceSemantic,
		Freshness:       RequireCurrent,
	})

	if selection.Status != ViewStatusUnavailable ||
		selection.Reason != ViewReasonSourceDifferent ||
		selection.View != nil {
		t.Fatalf("selection = %#v, want unavailable source-different", selection)
	}
}

func TestSavedProviderReturnsDifferentBytesAsSavedFallback(t *testing.T) {
	t.Parallel()

	selection := semanticSavedProvider(t, "saved-hash").BestAvailableView(ViewRequest{
		ScopeID: "scope",
		File:    "/repo/writer.ts",
		Document: &DocumentRevision{
			OpenEpoch: 1, Version: 2, SourceHash: "dirty-hash",
		},
		MinimumEvidence: EvidenceSemantic,
		Freshness:       AllowSavedFallback,
	})

	if selection.Status != ViewStatusSavedFallback ||
		selection.Reason != ViewReasonSourceDifferent ||
		selection.View == nil {
		t.Fatalf("selection = %#v, want source-different saved fallback", selection)
	}
	if source := selection.View.Sources["/repo/writer.ts"]; source.BufferMatch != BufferMatchDifferent {
		t.Fatalf("source evidence = %#v, want different buffer relationship", source)
	}
}

func semanticSavedProvider(t *testing.T, hash string) *SavedProvider {
	t.Helper()

	generation := uint64(7)
	store := readmodel.NewStore()
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Sources: []api.IndexSourceFile{{
			File: "/repo/writer.ts", Status: "indexed", SourceHash: hash,
		}},
	})
	return NewSavedProvider(store)
}
