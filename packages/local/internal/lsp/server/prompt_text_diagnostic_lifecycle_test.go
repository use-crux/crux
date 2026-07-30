package server

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextDiagnosticLifecycleClearsAndRegainsSavedBytes(t *testing.T) {
	const (
		root = "/repo"
		file = "/repo/source.ts"
		text = "const value = md`Hello ${true}`\n"
	)
	uri := protocol.DocumentURI("file:///repo/source.ts")
	server := New(Options{})
	server.diagnosticVersionSupport = true
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	recorder := newPromptTextDiagnosticRecorder()
	server.diagnostics = newDiagnosticComposer(diagnosticComposerOptions{
		Document: func(uri protocol.DocumentURI) diagnosticDocumentState {
			document, ok := server.buffers.Snapshot(uri)
			return diagnosticDocumentState{
				Revision: document.Revision,
				Version:  document.Version,
				Exact:    ok,
				Open:     ok,
			}
		},
		Publish: recorder.publish,
	})
	store := readmodel.NewStore()
	store.ApplySnapshot(root, promptTextDiagnosticSnapshot(text))
	session := &scopeSession{
		scope: readmodel.Scope{ID: root, Root: root},
		views: indexview.NewSavedProvider(store),
		mode:  readmodel.ModeOwn, transient: lifecyclePromptTextSource{},
		sourceEpoch: 1,
		promptTextDiagnostics: make(
			map[protocol.DocumentURI]*promptTextDiagnosticRequest,
		),
	}
	workspace := &workspaceRuntime{
		server: server, store: store, ctx: context.Background(),
		sessions: []*scopeSession{session},
	}
	session.publisher = NewPublisher(PublisherOptions{
		ScopeID: root, Root: root, Store: store,
		SubmitDiagnostics: server.diagnostics.SubmitLint,
	})
	t.Cleanup(workspace.Close)
	server.workspace = workspace

	open, _ := json.Marshal(protocol.DidOpenTextDocumentParams{
		TextDocument: protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 7, Text: text,
		},
	})
	server.didOpen(open)
	published := recorder.waitFor(t, func(params protocol.PublishDiagnosticsParams) bool {
		return params.Version != nil && *params.Version == 7 &&
			len(params.Diagnostics) == 1
	})
	diagnostic := published.Diagnostics[0]
	if diagnostic.Range != lifecycleExpressionRange() {
		t.Fatalf("diagnostic range = %#v, want expression range", diagnostic.Range)
	}

	change, _ := json.Marshal(protocol.DidChangeTextDocumentParams{
		TextDocument: protocol.VersionedTextDocumentIdentifier{
			TextDocumentIdentifier: protocol.TextDocumentIdentifier{URI: uri},
			Version:                8,
		},
		ContentChanges: []protocol.TextDocumentContentChangeEvent{{
			Range: &protocol.Range{
				Start: protocol.Position{Line: 0, Character: 25},
				End:   protocol.Position{Line: 0, Character: 29},
			},
			Text: "false",
		}},
	})
	server.didChange(change)
	cleared := recorder.latest(t)
	if cleared.Version == nil || *cleared.Version != 8 ||
		len(cleared.Diagnostics) != 0 {
		t.Fatalf("synchronous clear = %#v, want versioned empty lane", cleared)
	}
	time.Sleep(20 * time.Millisecond)
	if latest := recorder.latest(t); len(latest.Diagnostics) != 0 {
		t.Fatalf("stale analysis restored diagnostics: %#v", latest)
	}

	changeBack, _ := json.Marshal(protocol.DidChangeTextDocumentParams{
		TextDocument: protocol.VersionedTextDocumentIdentifier{
			TextDocumentIdentifier: protocol.TextDocumentIdentifier{URI: uri},
			Version:                9,
		},
		ContentChanges: []protocol.TextDocumentContentChangeEvent{{
			Range: &protocol.Range{
				Start: protocol.Position{Line: 0, Character: 25},
				End:   protocol.Position{Line: 0, Character: 30},
			},
			Text: "true",
		}},
	})
	server.didChange(changeBack)
	published = recorder.waitFor(t, func(params protocol.PublishDiagnosticsParams) bool {
		return params.Version != nil && *params.Version == 9 &&
			len(params.Diagnostics) == 1
	})
	actionParams, _ := json.Marshal(protocol.CodeActionParams{
		TextDocument: protocol.TextDocumentIdentifier{URI: uri},
		Range:        diagnostic.Range,
		Context: protocol.CodeActionContext{
			Diagnostics: published.Diagnostics,
		},
	})

	beforeSave := recorder.count()
	saveParams, _ := json.Marshal(protocol.DidSaveTextDocumentParams{
		TextDocument: protocol.TextDocumentIdentifier{URI: uri},
	})
	server.didSave(saveParams)
	_, clearIndex := recorder.waitForAfter(
		t,
		beforeSave,
		func(params protocol.PublishDiagnosticsParams) bool {
			return params.Version != nil && *params.Version == 9 &&
				len(params.Diagnostics) == 0
		},
	)
	time.Sleep(20 * time.Millisecond)
	if latest := recorder.latest(t); len(latest.Diagnostics) != 0 {
		t.Fatalf("pre-save semantic view was restored after save: %#v", latest)
	}
	staleAction := server.codeActionRequest(
		context.Background(),
		[]byte("11"),
		actionParams,
	)
	if staleAction.Deferred == nil {
		t.Fatal("save-gap action did not enter current revalidation")
	}
	staleAction = staleAction.Deferred()
	staleActions, ok := staleAction.Result.([]protocol.CodeAction)
	if staleAction.Error != nil || !ok || len(staleActions) != 0 {
		t.Fatalf("save-gap actions = %#v, want none", staleAction)
	}
	saved := promptTextDiagnosticSnapshot(text)
	savedGeneration := uint64(2)
	saved.Generation = &savedGeneration
	store.ApplySnapshot(root, saved)
	workspace.handleScopeChange(session, readmodel.Change{
		Scope: root, Files: []string{file}, Immediate: true,
	})
	published, _ = recorder.waitForAfter(
		t,
		clearIndex+1,
		func(params protocol.PublishDiagnosticsParams) bool {
			return params.Version != nil && *params.Version == 9 &&
				len(params.Diagnostics) == 1
		},
	)

	actionResponse := server.codeActionRequest(
		context.Background(), []byte("12"), actionParams,
	)
	if actionResponse.Deferred == nil {
		t.Fatal("PromptText action did not regenerate asynchronously")
	}
	actionResponse = actionResponse.Deferred()
	actions, ok := actionResponse.Result.([]protocol.CodeAction)
	if !ok || len(actions) != 1 ||
		actions[0].Edit.DocumentChanges[0].TextDocument.Version != 9 ||
		actions[0].Edit.DocumentChanges[0].Edits[0].NewText != "(md).json(true)" {
		t.Fatalf("actions = %#v, want regenerated version-9 serialization", actionResponse)
	}

	closeParams, _ := json.Marshal(protocol.DidCloseTextDocumentParams{
		TextDocument: protocol.TextDocumentIdentifier{URI: uri},
	})
	server.didClose(closeParams)
	closed := recorder.latest(t)
	if closed.Version != nil || len(closed.Diagnostics) != 0 {
		t.Fatalf("closed diagnostics = %#v, want unversioned empty lane", closed)
	}
	if _, retained := session.promptTextDiagnostics[uri]; retained {
		t.Fatal("didClose retained PromptText document request state")
	}
}

type lifecyclePromptTextSource struct{}

func (lifecyclePromptTextSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (lifecyclePromptTextSource) PromptText(
	_ context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File, Revision: request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range: lifecycleTemplateRange(), TagRange: staticprotocol.PromptTextRange{
				Start: staticprotocol.PromptTextPosition{Line: 0, Character: 14},
				End:   staticprotocol.PromptTextPosition{Line: 0, Character: 16},
			},
			TemplateRange: lifecycleTemplateRange(),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{{
				Index: 0,
				Range: staticprotocol.PromptTextRange{
					Start: staticprotocol.PromptTextPosition{Line: 0, Character: 23},
					End:   staticprotocol.PromptTextPosition{Line: 0, Character: 30},
				},
				ExpressionRange: staticprotocol.PromptTextRange{
					Start: staticprotocol.PromptTextPosition{Line: 0, Character: 25},
					End:   staticprotocol.PromptTextPosition{Line: 0, Character: 29},
				},
			}},
		}},
	}, nil
}

func lifecycleTemplateRange() staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 0, Character: 14},
		End:   staticprotocol.PromptTextPosition{Line: 0, Character: 31},
	}
}

func lifecycleExpressionRange() protocol.Range {
	return protocol.Range{
		Start: protocol.Position{Line: 0, Character: 25},
		End:   protocol.Position{Line: 0, Character: 29},
	}
}
