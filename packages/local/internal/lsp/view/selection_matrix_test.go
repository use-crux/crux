package view

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestSavedProviderHandlesLegacyAndMissingHashRelationships(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		generation *uint64
		savedHash  string
		freshness  FreshnessPolicy
		wantStatus ViewStatus
		wantReason ViewSelectionReason
	}{
		{
			name: "unknown generation requires current", savedHash: "saved",
			freshness: RequireCurrent, wantStatus: ViewStatusUnavailable,
			wantReason: ViewReasonGenerationUnknown,
		},
		{
			name: "unknown generation permits fallback", savedHash: "saved",
			freshness: AllowSavedFallback, wantStatus: ViewStatusSavedFallback,
			wantReason: ViewReasonGenerationUnknown,
		},
		{
			name: "missing saved hash requires current", generation: generationPointer(4),
			freshness: RequireCurrent, wantStatus: ViewStatusUnavailable,
			wantReason: ViewReasonSourceHashUnknown,
		},
		{
			name: "missing saved hash permits fallback", generation: generationPointer(4),
			freshness: AllowSavedFallback, wantStatus: ViewStatusSavedFallback,
			wantReason: ViewReasonSourceHashUnknown,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			selection := savedSelectionFixture("ready", test.generation, test.savedHash).
				BestAvailableView(ViewRequest{
					ScopeID: "scope", File: "/repo/writer.ts",
					Document:        &DocumentRevision{OpenEpoch: 1, Version: 2, SourceHash: "saved"},
					MinimumEvidence: EvidenceSemantic, Freshness: test.freshness,
				})
			if selection.Status != test.wantStatus || selection.Reason != test.wantReason {
				t.Fatalf("selection = %#v, want %s/%s", selection, test.wantStatus, test.wantReason)
			}
			if (selection.View != nil) != (test.wantStatus != ViewStatusUnavailable) {
				t.Fatalf("view presence = %v for status %s", selection.View != nil, selection.Status)
			}
		})
	}
}

func TestSavedProviderDerivesEvidenceOnlyFromReadySemanticStatus(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		status     string
		minimum    EvidenceLevel
		wantStatus ViewStatus
		wantReason ViewSelectionReason
		wantLevel  EvidenceLevel
	}{
		{
			name: "ready satisfies semantic", status: "ready", minimum: EvidenceSemantic,
			wantStatus: ViewStatusExact, wantReason: ViewReasonNone, wantLevel: EvidenceSemantic,
		},
		{
			name: "pending is index only", status: "pending", minimum: EvidenceSemantic,
			wantStatus: ViewStatusUnavailable, wantReason: ViewReasonEvidenceInsufficient,
		},
		{
			name: "disabled is index only", status: "disabled", minimum: EvidenceSemantic,
			wantStatus: ViewStatusUnavailable, wantReason: ViewReasonEvidenceInsufficient,
		},
		{
			name: "degraded is index only", status: "degraded", minimum: EvidenceSemantic,
			wantStatus: ViewStatusUnavailable, wantReason: ViewReasonEvidenceInsufficient,
		},
		{
			name: "missing is index only", minimum: EvidenceSemantic,
			wantStatus: ViewStatusUnavailable, wantReason: ViewReasonEvidenceInsufficient,
		},
		{
			name: "degraded satisfies index", status: "degraded", minimum: EvidenceIndex,
			wantStatus: ViewStatusExact, wantReason: ViewReasonNone, wantLevel: EvidenceIndex,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			selection := savedSelectionFixture(test.status, generationPointer(4), "saved").
				BestAvailableView(ViewRequest{
					ScopeID: "scope", File: "/repo/writer.ts",
					Document:        &DocumentRevision{OpenEpoch: 1, Version: 2, SourceHash: "saved"},
					MinimumEvidence: test.minimum, Freshness: RequireCurrent,
				})
			if selection.Status != test.wantStatus || selection.Reason != test.wantReason {
				t.Fatalf("selection = %#v, want %s/%s", selection, test.wantStatus, test.wantReason)
			}
			if selection.View != nil && selection.View.Stamp.Evidence != test.wantLevel {
				t.Fatalf("evidence = %s, want %s", selection.View.Stamp.Evidence, test.wantLevel)
			}
		})
	}
}

func TestSavedFallbackNeverDowngradesSemanticEvidence(t *testing.T) {
	t.Parallel()

	selection := savedSelectionFixture("degraded", generationPointer(4), "saved").
		BestAvailableView(ViewRequest{
			ScopeID: "scope", File: "/repo/writer.ts",
			Document:        &DocumentRevision{OpenEpoch: 1, Version: 2, SourceHash: "dirty"},
			MinimumEvidence: EvidenceSemantic, Freshness: AllowSavedFallback,
		})
	if selection.Status != ViewStatusUnavailable ||
		selection.Reason != ViewReasonEvidenceInsufficient ||
		selection.View != nil {
		t.Fatalf("selection = %#v, want unavailable insufficient evidence", selection)
	}
}

func TestSavedProviderTreatsSavedAuthorityAsCurrentWithoutDocument(t *testing.T) {
	t.Parallel()

	exact := savedSelectionFixture("ready", generationPointer(4), "saved").
		BestAvailableView(ViewRequest{
			ScopeID: "scope", File: "/repo/writer.ts",
			MinimumEvidence: EvidenceSemantic, Freshness: RequireCurrent,
		})
	if exact.Status != ViewStatusExact || exact.View == nil {
		t.Fatalf("known saved authority = %#v, want exact", exact)
	}
	if source := exact.View.Sources["/repo/writer.ts"]; source.BufferMatch != BufferMatchUnknown {
		t.Fatalf("source = %#v, want unknown without editor comparison", source)
	}

	unknown := savedSelectionFixture("ready", nil, "saved").
		BestAvailableView(ViewRequest{
			ScopeID: "scope", File: "/repo/writer.ts",
			MinimumEvidence: EvidenceSemantic, Freshness: RequireCurrent,
		})
	if unknown.Status != ViewStatusUnavailable || unknown.Reason != ViewReasonGenerationUnknown {
		t.Fatalf("unknown saved authority = %#v, want unavailable", unknown)
	}
}

func TestSavedProviderRecognizesEditReturnToSavedBytes(t *testing.T) {
	t.Parallel()

	provider := savedSelectionFixture("ready", generationPointer(4), "saved")
	different := provider.BestAvailableView(ViewRequest{
		ScopeID: "scope", File: "/repo/writer.ts",
		Document:        &DocumentRevision{OpenEpoch: 1, Version: 2, SourceHash: "dirty"},
		MinimumEvidence: EvidenceSemantic, Freshness: RequireCurrent,
	})
	returned := provider.BestAvailableView(ViewRequest{
		ScopeID: "scope", File: "/repo/writer.ts",
		Document:        &DocumentRevision{OpenEpoch: 1, Version: 3, SourceHash: "saved"},
		MinimumEvidence: EvidenceSemantic, Freshness: RequireCurrent,
	})
	if different.Status != ViewStatusUnavailable || returned.Status != ViewStatusExact {
		t.Fatalf("edit selections = (%#v, %#v), want unavailable then exact", different, returned)
	}
}

func savedSelectionFixture(
	semanticStatus string,
	generation *uint64,
	sourceHash string,
) *SavedProvider {
	store := readmodel.NewStore()
	var indexing *api.ProjectIndexingStatus
	if semanticStatus != "" {
		indexing = &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: semanticStatus},
		}
	}
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: generation,
		Indexing:   indexing,
		Sources: []api.IndexSourceFile{{
			File: "/repo/writer.ts", Status: "indexed", SourceHash: sourceHash,
		}},
	})
	return NewSavedProvider(store)
}

func generationPointer(generation uint64) *uint64 {
	return &generation
}
