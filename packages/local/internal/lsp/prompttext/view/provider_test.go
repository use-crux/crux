package view

import (
	"context"
	"crypto/sha256"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestLiveProviderSelectsOnePublicationAndTransformsSavedFallback(t *testing.T) {
	const (
		scope = "scope"
		file  = "/repo/writer.ts"
	)
	source := "const owner = 1;\nconst value = md`hello`;\n"
	store := readmodel.NewStore()
	generation := uint64(7)
	store.ApplySnapshot(scope, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{promptTextViewDefinition(file)},
		Sources: []api.IndexSourceFile{{
			File: file, SourceHash: hashText(source),
		}},
	})
	provider := NewProvider(indexview.NewSavedProvider(store), Options{Root: "/repo"})
	opened := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 1, SourceHash: hashText(source),
	}
	if !provider.Open(Request{
		ScopeID: scope, File: file, Document: &opened,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	}) {
		t.Fatal("exact open did not establish transform state")
	}

	dirty := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 2, SourceHash: hashText("\n" + source),
	}
	provider.Change(file, dirty, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{}, Text: "\n",
	}})
	selection := provider.Select(context.Background(), Request{
		ScopeID: scope, File: file, Document: &dirty,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if selection.Status != indexview.ViewStatusSavedFallback || selection.View == nil {
		t.Fatalf("selection = %#v, want saved fallback", selection)
	}
	if got := selection.View.PromptTextRefs[0].Template.Range; got != testRange(2, 14, 2, 23) {
		t.Fatalf("transformed template = %#v, want one-line shift", got)
	}
	if selection.View.Stamp.RequestDocument == nil ||
		*selection.View.Stamp.RequestDocument != dirty ||
		len(selection.View.Documents) != 1 ||
		selection.View.Documents[0].Revision != dirty {
		t.Fatalf("stamps = %#v / %#v, want exact dirty revision", selection.View.Stamp, selection.View.Documents)
	}

	generation++
	store.ApplySnapshot(scope, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{promptTextViewDefinition(file)},
		Sources: []api.IndexSourceFile{{
			File: file, SourceHash: hashText(source),
		}},
	})
	if provider.Open(Request{
		ScopeID: scope, File: file, Document: &dirty,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	}) {
		t.Fatal("dirty refresh unexpectedly replaced the transform chain")
	}
	selection = provider.Select(context.Background(), Request{
		ScopeID: scope, File: file, Document: &dirty,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if selection.View == nil ||
		selection.View.PromptTextRefs[0].Template.Range != testRange(2, 14, 2, 23) {
		t.Fatalf("same-base generation did not reuse transforms: %#v", selection)
	}

	reverted := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 3, SourceHash: hashText(source),
	}
	provider.Change(file, reverted, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{},
			End:   protocol.Position{Line: 1},
		},
		Text: "",
	}})
	selection = provider.Select(context.Background(), Request{
		ScopeID: scope, File: file, Document: &reverted,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if selection.Status != indexview.ViewStatusExact || selection.View == nil ||
		selection.View.PromptTextRefs[0].Template.Range != testRange(1, 14, 1, 23) {
		t.Fatalf("reverted selection = %#v, want direct exact saved range", selection)
	}
}

func TestLiveProviderInvalidatesOverlappingPromptTextRecords(t *testing.T) {
	const (
		scope = "scope"
		file  = "/repo/writer.ts"
	)
	source := "const owner = 1;\nconst value = md`hello`;\n"
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot(scope, readmodel.Snapshot{
		Generation:  &generation,
		Indexing:    &api.ProjectIndexingStatus{Semantic: api.IndexIndexingSemanticStatus{Status: "ready"}},
		Definitions: []api.ProjectDefinition{promptTextViewDefinition(file)},
		Sources:     []api.IndexSourceFile{{File: file, SourceHash: hashText(source)}},
	})
	provider := NewProvider(indexview.NewSavedProvider(store), Options{Root: "/repo"})
	opened := indexview.DocumentRevision{OpenEpoch: 1, Version: 1, SourceHash: hashText(source)}
	provider.Open(Request{
		ScopeID: scope, File: file, Document: &opened,
		MinimumEvidence: indexview.EvidenceSemantic, Freshness: indexview.AllowSavedFallback,
	})
	dirty := indexview.DocumentRevision{OpenEpoch: 1, Version: 2, SourceHash: hashText(source + "x")}
	provider.Change(file, dirty, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 1, Character: 18},
			End:   protocol.Position{Line: 1, Character: 18},
		},
		Text: "x",
	}})
	selection := provider.Select(context.Background(), Request{
		ScopeID: scope, File: file, Document: &dirty,
		MinimumEvidence: indexview.EvidenceSemantic, Freshness: indexview.AllowSavedFallback,
	})
	if selection.View == nil || len(selection.View.PromptTextRefs) != 0 {
		t.Fatalf("overlapping ref survived: %#v", selection)
	}
}

func TestLiveProviderKeepsInitiallyDirtyOpenDocumentUnavailable(t *testing.T) {
	const (
		scope = "scope"
		file  = "/repo/writer.ts"
	)
	saved := "const value = md`saved`;\n"
	dirty := "const value = md`dirty`;\n"
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot(scope, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{promptTextViewDefinition(file)},
		Sources:     []api.IndexSourceFile{{File: file, SourceHash: hashText(saved)}},
	})
	provider := NewProvider(indexview.NewSavedProvider(store), Options{Root: "/repo"})
	revision := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 1, SourceHash: hashText(dirty),
	}
	if provider.Open(Request{
		ScopeID: scope, File: file, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	}) {
		t.Fatal("initially dirty open unexpectedly established saved ranges")
	}
	selection := provider.Select(context.Background(), Request{
		ScopeID: scope, File: file, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if selection.View == nil || len(selection.View.PromptTextRefs) != 0 ||
		len(selection.View.Documents) != 1 {
		t.Fatalf("initially dirty selection = %#v, want unavailable records", selection)
	}

	provider.Retire(file)
	closed := provider.Select(context.Background(), Request{
		ScopeID: scope, File: file,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if closed.View == nil || len(closed.View.PromptTextRefs) != 1 {
		t.Fatalf("closed selection = %#v, want saved records", closed)
	}
}

func promptTextViewDefinition(file string) api.ProjectDefinition {
	definitionStart, definitionEnd := 1, 16
	templateStart, templateEnd := 15, 24
	definitionEndLine, templateEndLine := 1, 2
	return api.ProjectDefinition{
		ID: "prompt:owner", Kind: "prompt", Name: "owner", Fidelity: "resolved",
		SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
			File: file, StartLine: 1, StartColumn: &definitionStart,
			EndLine: &definitionEndLine, EndColumn: &definitionEnd,
		}},
		SourceRefs: []api.ProjectSourceRef{{
			ID: "ref:owner", Role: "prompt", Property: "prompt",
			Source: api.SourceLoc{File: file, Line: 2, Column: &templateStart},
			Snippet: &api.SourceSnippet{
				Source: "md`hello`",
				Range: api.SourceRange{
					File: file, StartLine: 2, StartColumn: &templateStart,
					EndLine: &templateEndLine, EndColumn: &templateEnd,
				},
			},
			Fidelity: "resolved",
			Metadata: map[string]any{"promptText": map[string]any{
				"tag": "md", "language": "markdown", "lifecycle": "static",
				"sourceKind": "owner",
			}},
		}},
	}
}

func hashText(text string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
}
