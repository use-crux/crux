package server

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/jsonrpc"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestPromptTextDiagnosticSourceLossGainRejectsStaleEpoch(t *testing.T) {
	t.Parallel()

	blocked := &blockedPromptTextSource{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	_, workspace, session, recorder, uri := newPromptTextSourceHarness(
		t,
		blocked,
	)
	workspace.resetPromptTextDiagnostics(session, uri, true)
	<-blocked.started

	beforeLoss := recorder.count()
	workspace.setSessionTransientSource(session, nil)
	_, clearIndex := recorder.waitForAfter(
		t,
		beforeLoss,
		func(params protocol.PublishDiagnosticsParams) bool {
			return params.Version != nil && *params.Version == 7 &&
				len(params.Diagnostics) == 0
		},
	)
	close(blocked.release)
	time.Sleep(20 * time.Millisecond)
	if latest := recorder.latest(t); len(latest.Diagnostics) != 0 {
		t.Fatalf("retired source restored stale diagnostics: %#v", latest)
	}

	workspace.setSessionTransientSource(session, lifecyclePromptTextSource{})
	published, _ := recorder.waitForAfter(
		t,
		clearIndex+1,
		func(params protocol.PublishDiagnosticsParams) bool {
			return params.Version != nil && *params.Version == 7 &&
				len(params.Diagnostics) == 1
		},
	)
	if published.Diagnostics[0].Range != lifecycleExpressionRange() {
		t.Fatalf("regained diagnostic = %#v, want current expression", published)
	}
	if session.sourceEpoch != 3 {
		t.Fatalf("source epoch = %d, want loss and gain epochs", session.sourceEpoch)
	}
}

func TestPromptTextActionRejectsConcurrentSourceEpochChange(t *testing.T) {
	t.Parallel()

	blocked := &blockedPromptTextSource{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	server, workspace, session, _, uri := newPromptTextSourceHarness(
		t,
		blocked,
	)
	server.diagnosticDataSupport = true
	server.codeActionLiteralSupport = true
	_, cancelDiagnostic := context.WithCancel(context.Background())
	t.Cleanup(cancelDiagnostic)
	session.promptTextDiagnostics[uri] = &promptTextDiagnosticRequest{
		generation: 1, cancel: cancelDiagnostic,
	}
	params := promptTextActionParams(
		"prompt-text:0000000000000000000000000000000000000000000000000000000000000001",
		lifecycleExpressionRange(),
	)
	raw, _ := json.Marshal(params)
	response := server.codeActionRequest(
		context.Background(),
		[]byte("31"),
		raw,
	)
	if response.Deferred == nil {
		t.Fatal("PromptText action did not begin current revalidation")
	}
	done := make(chan jsonrpc.HandlerResult, 1)
	go func() {
		done <- response.Deferred()
	}()
	<-blocked.started
	workspace.setSessionTransientSource(session, nil)
	close(blocked.release)
	result := <-done
	actions, ok := result.Result.([]protocol.CodeAction)
	if result.Error != nil || !ok || len(actions) != 0 {
		t.Fatalf("stale source action = %#v, want empty contribution", result)
	}
}

func TestPromptTextSourceGainClearsBeforeAcceptingNewEpoch(t *testing.T) {
	t.Parallel()

	server, workspace, session, _, uri := newPromptTextSourceHarness(
		t,
		nil,
	)
	clearStarted := make(chan struct{})
	releaseClear := make(chan struct{})
	server.diagnostics = newDiagnosticComposer(diagnosticComposerOptions{
		Document: func(uri protocol.DocumentURI) diagnosticDocumentState {
			document, ok := server.buffers.Snapshot(uri)
			return diagnosticDocumentState{
				Revision: document.Revision,
				Version:  7,
				Exact:    ok,
				Open:     true,
			}
		},
		Publish: func(protocol.PublishDiagnosticsParams) {
			close(clearStarted)
			<-releaseClear
		},
	})
	transitioned := make(chan struct{})
	go func() {
		workspace.setSessionTransientSource(
			session,
			lifecyclePromptTextSource{},
		)
		close(transitioned)
	}()
	<-clearStarted

	result := workspace.PromptTextActions(
		context.Background(),
		uri,
		[]promptTextActionLocator{{
			ID:              "prompt-text:0000000000000000000000000000000000000000000000000000000000000001",
			DiagnosticRange: lifecycleExpressionRange(),
			RequestRange:    lifecycleExpressionRange(),
		}},
	)
	close(releaseClear)
	<-transitioned
	if len(result.Actions) != 0 {
		t.Fatalf(
			"new source epoch accepted before diagnostic clear: %#v",
			result.Actions,
		)
	}
}

func TestPromptTextDiagnosticReindexGapClearsAndRegainsCoherentView(
	t *testing.T,
) {
	t.Parallel()

	const (
		root = "/repo"
		file = "/repo/source.ts"
		text = "const value = md`Hello ${true}`\n"
	)
	_, workspace, session, recorder, uri := newPromptTextSourceHarness(
		t,
		lifecyclePromptTextSource{},
	)
	workspace.resetPromptTextDiagnostics(session, uri, true)
	recorder.waitFor(t, func(params protocol.PublishDiagnosticsParams) bool {
		return params.Version != nil && *params.Version == 7 &&
			len(params.Diagnostics) == 1
	})

	pending := promptTextDiagnosticSnapshot(text)
	pendingGeneration := uint64(2)
	pending.Generation = &pendingGeneration
	pending.Indexing.Semantic.Status = "pending"
	workspace.store.ApplySnapshot(root, pending)
	beforePending := recorder.count()
	workspace.handleScopeChange(session, readmodel.Change{
		Scope: root, Files: []string{file}, Immediate: true,
	})
	_, clearIndex := recorder.waitForAfter(
		t,
		beforePending,
		func(params protocol.PublishDiagnosticsParams) bool {
			return params.Version != nil && *params.Version == 7 &&
				len(params.Diagnostics) == 0
		},
	)
	time.Sleep(20 * time.Millisecond)
	if latest := recorder.latest(t); len(latest.Diagnostics) != 0 {
		t.Fatalf("pending semantic view published PromptText: %#v", latest)
	}

	ready := promptTextDiagnosticSnapshot(text)
	readyGeneration := uint64(3)
	ready.Generation = &readyGeneration
	workspace.store.ApplySnapshot(root, ready)
	workspace.handleScopeChange(session, readmodel.Change{
		Scope: root, Files: []string{file}, Immediate: true,
	})
	published, _ := recorder.waitForAfter(
		t,
		clearIndex+1,
		func(params protocol.PublishDiagnosticsParams) bool {
			return params.Version != nil && *params.Version == 7 &&
				len(params.Diagnostics) == 1
		},
	)
	if published.Diagnostics[0].Range != lifecycleExpressionRange() {
		t.Fatalf("coherent reindex diagnostic = %#v", published)
	}
}

func newPromptTextSourceHarness(
	t *testing.T,
	source readmodel.TransientSource,
) (
	*Server,
	*workspaceRuntime,
	*scopeSession,
	*promptTextDiagnosticRecorder,
	protocol.DocumentURI,
) {
	t.Helper()
	const (
		root = "/repo"
		text = "const value = md`Hello ${true}`\n"
	)
	uri := protocol.DocumentURI("file:///repo/source.ts")
	server := New(Options{})
	server.diagnosticVersionSupport = true
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
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 7, Text: text,
	})
	store := readmodel.NewStore()
	store.ApplySnapshot(root, promptTextDiagnosticSnapshot(text))
	session := &scopeSession{
		scope: readmodel.Scope{ID: root, Root: root},
		views: indexview.NewSavedProvider(store),
		mode:  readmodel.ModeOwn, transient: source, sourceEpoch: 1,
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
	session.publisher.DidOpen(uri, 7)
	server.workspace = workspace
	t.Cleanup(workspace.Close)
	return server, workspace, session, recorder, uri
}

type blockedPromptTextSource struct {
	started chan struct{}
	release chan struct{}
}

func (*blockedPromptTextSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *blockedPromptTextSource) PromptText(
	ctx context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	close(s.started)
	<-s.release
	return lifecyclePromptTextSource{}.PromptText(ctx, request)
}
