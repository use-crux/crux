package view

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestLiveProviderTransformsDirtyCrossDocumentDestination(t *testing.T) {
	const (
		scope       = "scope"
		requestFile = "/repo/writer.ts"
		ownerFile   = "/repo/owner.ts"
	)
	requestSource := "const value = md`hello`;\n"
	ownerSource := "export const owner = 1;\n"
	definition := promptTextViewDefinition(requestFile)
	definition.SourceSnippet.Range = api.SourceRange{
		File: ownerFile, StartLine: 1, StartColumn: metadataInt(14),
		EndLine: metadataInt(1), EndColumn: metadataInt(19),
	}
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot(scope, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{definition},
		Sources: []api.IndexSourceFile{
			{File: requestFile, SourceHash: hashText(requestSource)},
			{File: ownerFile, SourceHash: hashText(ownerSource)},
		},
	})
	provider := NewProvider(indexview.NewSavedProvider(store), Options{Root: "/repo"})
	requestRevision := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 1, SourceHash: hashText(requestSource),
	}
	ownerRevision := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 1, SourceHash: hashText(ownerSource),
	}
	for file, revision := range map[string]*indexview.DocumentRevision{
		requestFile: &requestRevision,
		ownerFile:   &ownerRevision,
	} {
		if !provider.Open(Request{
			ScopeID: scope, File: file, Document: revision,
			MinimumEvidence: indexview.EvidenceSemantic,
			Freshness:       indexview.AllowSavedFallback,
		}) {
			t.Fatalf("exact open did not establish %s", file)
		}
	}
	dirtyOwner := indexview.DocumentRevision{
		OpenEpoch: 1, Version: 2, SourceHash: hashText("\n" + ownerSource),
	}
	provider.Change(ownerFile, dirtyOwner, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{}, Text: "\n",
	}})

	selection := provider.Select(context.Background(), Request{
		ScopeID: scope, File: requestFile, Document: &requestRevision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})

	if selection.View == nil || len(selection.View.Definitions) != 1 ||
		selection.View.Definitions[0].Location.File != ownerFile ||
		selection.View.Definitions[0].Location.Range != testRange(1, 13, 1, 18) {
		t.Fatalf("cross-document destination = %#v", selection)
	}
	if len(selection.View.Documents) != 2 {
		t.Fatalf("document stamps = %#v, want both open documents", selection.View.Documents)
	}
}
