package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestWorkspaceNavigationRequestsSemanticSavedFallbackOnce(t *testing.T) {
	t.Parallel()

	const scope = "scope"
	root := t.TempDir()
	targetFile := navigationTestFile(t, root, "target.ts", "writer\n")
	usageFile := navigationTestFile(t, root, "usage.ts", "writer\n")
	column := 1
	generation := uint64(2)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{
			navigationTestDefinition("prompt:writer", targetFile, 1, &column, nil),
		},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", To: "prompt:writer",
			Source: &api.SourceLoc{File: usageFile, Line: 1, Column: &column},
		}},
	})
	publisher := NewPublisher(PublisherOptions{
		ScopeID: scope, Root: root, Store: store, Lines: mapping.NewLineIndex(),
	})
	t.Cleanup(publisher.Close)
	views := &recordingViewProvider{delegate: indexview.NewSavedProvider(store)}
	workspace := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: scope, Root: root}, publisher: publisher, views: views,
	}}}

	location, ok := workspace.DefinitionLocation(
		protocol.DocumentURI(mapping.FileURI(root, usageFile)),
		protocol.Position{},
	)
	if !ok || location.URI != protocol.DocumentURI(mapping.FileURI(root, targetFile)) {
		t.Fatalf("definition = %#v, %v; want target", location, ok)
	}
	if len(views.requests) != 1 {
		t.Fatalf("view requests = %#v, want one coherent selection", views.requests)
	}
	request := views.requests[0]
	if request.ScopeID != scope || request.File != usageFile || request.Document != nil ||
		request.MinimumEvidence != indexview.EvidenceSemantic ||
		request.Freshness != indexview.AllowSavedFallback {
		t.Fatalf("view request = %#v, want semantic saved fallback", request)
	}
}

func TestWorkspaceNavigationUsesSelectedRecordsWithTransformedOpenRanges(t *testing.T) {
	t.Parallel()

	const scope = "scope"
	root := t.TempDir()
	usageFile := navigationTestFile(t, root, "usage.ts", "writer\n")
	targetA := navigationTestFile(t, root, "a.ts", "a\n")
	targetB := navigationTestFile(t, root, "b.ts", "b\n")
	usageURI := protocol.DocumentURI(mapping.FileURI(root, usageFile))
	column := 1
	generationA := uint64(1)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, navigationSemanticSnapshot(readmodel.Snapshot{
		Generation: &generationA,
		Definitions: []api.ProjectDefinition{
			navigationTestDefinition("prompt:a", targetA, 1, &column, nil),
		},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", To: "prompt:a",
			Source: &api.SourceLoc{File: usageFile, Line: 1, Column: &column},
		}},
	}))
	publisher := NewPublisher(PublisherOptions{
		ScopeID: scope, Root: root, Store: store, Lines: mapping.NewLineIndex(),
	})
	t.Cleanup(publisher.Close)
	workspace := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: scope, Root: root}, publisher: publisher,
		views: indexview.NewSavedProvider(store),
	}}}
	workspace.DidOpen(usageURI, 1)
	zero := protocol.Position{}
	workspace.DidChange(usageURI, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})

	generationB := uint64(2)
	changed := store.ApplySnapshot(scope, navigationSemanticSnapshot(readmodel.Snapshot{
		Generation: &generationB,
		Definitions: []api.ProjectDefinition{
			navigationTestDefinition("prompt:b", targetB, 1, &column, nil),
		},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", To: "prompt:b",
			Source: &api.SourceLoc{File: usageFile, Line: 1, Column: &column},
		}},
	}))
	publisher.Change(readmodel.Change{Scope: scope, Files: changed, Immediate: true})

	location, ok := workspace.DefinitionLocation(
		usageURI,
		protocol.Position{Line: 1},
	)
	if !ok || location.URI != protocol.DocumentURI(mapping.FileURI(root, targetB)) {
		t.Fatalf("definition = %#v, %v; want selected target with transformed source range", location, ok)
	}
}

func TestWorkspaceReferencesUseSelectedRecordsWithTransformedOpenRanges(t *testing.T) {
	t.Parallel()

	const scope = "scope"
	root := t.TempDir()
	targetFile := navigationTestFile(t, root, "target.ts", "writer\n")
	otherFile := navigationTestFile(t, root, "other.ts", "other\n")
	usageFile := navigationTestFile(t, root, "usage.ts", "writer\n")
	targetURI := protocol.DocumentURI(mapping.FileURI(root, targetFile))
	usageURI := protocol.DocumentURI(mapping.FileURI(root, usageFile))
	column := 1
	generationA := uint64(1)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, navigationSemanticSnapshot(readmodel.Snapshot{
		Generation: &generationA,
		Definitions: []api.ProjectDefinition{
			navigationTestDefinition("prompt:writer", targetFile, 1, &column, nil),
		},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", To: "prompt:writer",
			Source: &api.SourceLoc{File: usageFile, Line: 1, Column: &column},
		}},
	}))
	publisher := NewPublisher(PublisherOptions{
		ScopeID: scope, Root: root, Store: store, Lines: mapping.NewLineIndex(),
	})
	t.Cleanup(publisher.Close)
	workspace := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: scope, Root: root}, publisher: publisher,
		views: indexview.NewSavedProvider(store),
	}}}
	workspace.DidOpen(usageURI, 1)
	zero := protocol.Position{}
	workspace.DidChange(usageURI, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})

	generationB := uint64(2)
	changed := store.ApplySnapshot(scope, navigationSemanticSnapshot(readmodel.Snapshot{
		Generation: &generationB,
		Definitions: []api.ProjectDefinition{
			navigationTestDefinition("prompt:writer", targetFile, 1, &column, nil),
			navigationTestDefinition("prompt:other", otherFile, 1, &column, nil),
		},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", To: "prompt:other",
			Source: &api.SourceLoc{File: usageFile, Line: 1, Column: &column},
		}},
	}))
	publisher.Change(readmodel.Change{Scope: scope, Files: changed, Immediate: true})

	references := workspace.ReferenceLocations(
		targetURI,
		protocol.Position{},
		false,
	)
	if len(references) != 0 {
		t.Fatalf("references = %#v, want selected publication to exclude stale displayed target", references)
	}
}

type recordingViewProvider struct {
	delegate indexview.ViewProvider
	requests []indexview.ViewRequest
}

func (p *recordingViewProvider) BestAvailableView(request indexview.ViewRequest) indexview.ViewSelection {
	p.requests = append(p.requests, request)
	return p.delegate.BestAvailableView(request)
}
