package server

import (
	"context"
	"crypto/sha256"
	"fmt"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestWorkspacePromptTextViewRetiresOnSaveAndReestablishesAfterPublication(t *testing.T) {
	t.Parallel()

	const scope = "scope"
	root := t.TempDir()
	file := navigationTestFile(t, root, "source.ts", "const value = md`hello`;\n")
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	saved := "const value = md`hello`;\n"
	dirty := "\n" + saved
	generation := uint64(1)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, promptTextViewSnapshot(
		generation,
		file,
		saved,
		1,
	))
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: saved,
	})
	savedViews := indexview.NewSavedProvider(store)
	session := &scopeSession{
		scope: readmodel.Scope{ID: scope, Root: root},
		views: savedViews,
		promptTextViews: promptview.NewProvider(
			savedViews,
			promptview.Options{Root: root},
		),
		promptTextDiagnostics: make(
			map[protocol.DocumentURI]*promptTextDiagnosticRequest,
		),
		promptTextAcceptedViews: make(
			map[protocol.DocumentURI]indexview.ViewStamp,
		),
		promptTextRetiredViews: make(
			map[protocol.DocumentURI]indexview.ViewStamp,
		),
	}
	session.publisher = NewPublisher(PublisherOptions{
		ScopeID: scope, Root: root, Store: store,
	})
	workspace := &workspaceRuntime{
		server: server, store: store, ctx: context.Background(),
		sessions: []*scopeSession{session},
	}
	server.workspace = workspace
	t.Cleanup(workspace.Close)

	workspace.DidOpen(uri, 1)
	server.changeDocument(protocol.DidChangeTextDocumentParams{
		TextDocument: protocol.VersionedTextDocumentIdentifier{
			TextDocumentIdentifier: protocol.TextDocumentIdentifier{URI: uri},
			Version:                2,
		},
		ContentChanges: []protocol.TextDocumentContentChangeEvent{{
			Range: &protocol.Range{}, Text: "\n",
		}},
	})
	workspace.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{}, Text: "\n",
	}})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("dirty document unavailable")
	}
	selection := selectPromptTextWorkspaceView(
		t,
		session,
		file,
		document,
		indexview.AllowSavedFallback,
	)
	if selection.Status != indexview.ViewStatusSavedFallback ||
		len(selection.View.PromptTextRefs) != 1 ||
		selection.View.PromptTextRefs[0].Template.Range.Start.Line != 1 {
		t.Fatalf("dirty transformed selection = %#v", selection)
	}

	workspace.DidSave(uri)
	selection = selectPromptTextWorkspaceView(
		t,
		session,
		file,
		document,
		indexview.AllowSavedFallback,
	)
	if len(selection.View.PromptTextRefs) != 0 {
		t.Fatalf("post-save selection retained stale transforms: %#v", selection)
	}

	generation++
	changed := store.ApplySnapshot(scope, promptTextViewSnapshot(
		generation,
		file,
		dirty,
		2,
	))
	workspace.handleScopeChange(session, readmodel.Change{
		Scope: scope, Files: changed, Immediate: true,
	})
	selection = selectPromptTextWorkspaceView(
		t,
		session,
		file,
		document,
		indexview.AllowSavedFallback,
	)
	if selection.Status != indexview.ViewStatusExact ||
		len(selection.View.PromptTextRefs) != 1 ||
		selection.View.PromptTextRefs[0].Template.Range.Start.Line != 1 {
		t.Fatalf("reestablished selection = %#v", selection)
	}
}

func TestWorkspacePromptTextViewKeepsUnavailableOpenDestinationHidden(t *testing.T) {
	t.Parallel()

	const scope = "scope"
	root := t.TempDir()
	file := navigationTestFile(t, root, "large.ts", "const value = md`hello`;\n")
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	source := "const value = md`hello`;\n"
	generation := uint64(1)
	store := readmodel.NewStore()
	store.ApplySnapshot(scope, promptTextViewSnapshot(
		generation,
		file,
		source,
		1,
	))
	server := New(Options{})
	server.buffers = newDocumentBuffers(documentBufferLimits{
		DocumentBytes: 1,
		ProcessBytes:  1,
	})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: source,
	})
	savedViews := indexview.NewSavedProvider(store)
	session := &scopeSession{
		scope: readmodel.Scope{ID: scope, Root: root},
		views: savedViews,
		promptTextViews: promptview.NewProvider(
			savedViews,
			promptview.Options{Root: root},
		),
	}
	workspace := &workspaceRuntime{server: server, store: store}

	workspace.openPromptTextView(session, uri)
	assertUnavailablePromptTextDestination(t, session, file)

	session.promptTextViews.RetireAll()
	workspace.refreshPromptTextViews(session, nil)
	assertUnavailablePromptTextDestination(t, session, file)

	server.buffers.Close(uri)
	workspace.retirePromptTextView(session, uri)
	selection := session.promptTextViews.Select(
		context.Background(),
		promptview.Request{
			ScopeID: scope, File: file,
			MinimumEvidence: indexview.EvidenceSemantic,
			Freshness:       indexview.AllowSavedFallback,
		},
	)
	if selection.View == nil || len(selection.View.PromptTextRefs) != 1 {
		t.Fatalf("closed destination = %#v, want saved range", selection)
	}
}

func assertUnavailablePromptTextDestination(
	t *testing.T,
	session *scopeSession,
	file string,
) {
	t.Helper()
	selection := session.promptTextViews.Select(
		context.Background(),
		promptview.Request{
			ScopeID: session.scope.ID, File: file,
			MinimumEvidence: indexview.EvidenceSemantic,
			Freshness:       indexview.AllowSavedFallback,
		},
	)
	if selection.View == nil ||
		len(selection.View.Definitions) != 0 ||
		len(selection.View.PromptTextRefs) != 0 {
		t.Fatalf("unavailable open destination = %#v, want omitted", selection)
	}
}

func selectPromptTextWorkspaceView(
	t *testing.T,
	session *scopeSession,
	file string,
	document documentSnapshot,
	freshness indexview.FreshnessPolicy,
) promptview.Selection {
	t.Helper()
	revision := promptTextViewRevision(document)
	selection := session.promptTextViews.Select(context.Background(), promptview.Request{
		ScopeID: session.scope.ID, File: file, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       freshness,
	})
	if selection.View == nil {
		t.Fatalf("selection = %#v, want view", selection)
	}
	return selection
}

func promptTextViewSnapshot(
	generation uint64,
	file string,
	text string,
	line int,
) readmodel.Snapshot {
	column, endLine, endColumn := 15, line, 24
	definitionColumn, definitionEndColumn := 1, 26
	return readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:owner", Kind: "prompt", Name: "owner",
			SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
				File: file, StartLine: line, StartColumn: &definitionColumn,
				EndLine: &endLine, EndColumn: &definitionEndColumn,
			}},
			SourceRefs: []api.ProjectSourceRef{{
				ID: "prompt:owner:source:prompt", Role: "prompt", Property: "prompt",
				Source: api.SourceLoc{File: file, Line: line, Column: &column},
				Snippet: &api.SourceSnippet{
					Source: "md`hello`",
					Range: api.SourceRange{
						File: file, StartLine: line, StartColumn: &column,
						EndLine: &endLine, EndColumn: &endColumn,
					},
				},
				Fidelity: "resolved",
				Metadata: map[string]any{"promptText": map[string]any{
					"tag": "md", "language": "markdown", "lifecycle": "static",
					"sourceKind": "owner",
				}},
			}},
		}},
		Sources: []api.IndexSourceFile{{
			File: file, SourceHash: promptTextViewHash(text),
		}},
	}
}

func promptTextViewHash(text string) string {
	return fmt.Sprintf("%x", sha256.Sum256([]byte(text)))
}
