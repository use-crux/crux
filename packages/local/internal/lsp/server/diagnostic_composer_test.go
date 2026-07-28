package server

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

func TestPromptTextDiagnosticComposerOrdersLanesAndPinsOpenVersion(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/writer.ts")
	revision := transient.NewRevision(3, 7, "source")
	var (
		mu        sync.Mutex
		published []protocol.PublishDiagnosticsParams
	)
	composer := newDiagnosticComposer(diagnosticComposerOptions{
		Document: func(got protocol.DocumentURI) diagnosticDocumentState {
			return diagnosticDocumentState{
				Revision: revision,
				Version:  7,
				Exact:    got == uri,
				Open:     got == uri,
			}
		},
		Publish: func(params protocol.PublishDiagnosticsParams) {
			mu.Lock()
			published = append(published, params)
			mu.Unlock()
		},
	})
	lint := protocol.Diagnostic{
		Range: protocol.Range{Start: protocol.Position{Line: 4}},
		Code:  "lint", Message: "lint",
	}
	promptLate := promptTextComposerDiagnostic(t, "b", 3)
	promptEarly := promptTextComposerDiagnostic(t, "a", 1)

	composer.SubmitLint(uri, []protocol.Diagnostic{lint})
	composer.SubmitPromptText(
		uri,
		promptTextDiagnosticStamp{Revision: revision},
		[]protocol.Diagnostic{promptLate, promptEarly},
	)
	composer.ClearPromptText(uri)

	mu.Lock()
	defer mu.Unlock()
	if len(published) != 3 {
		t.Fatalf("published = %#v, want three complete replacements", published)
	}
	if published[1].Version == nil || *published[1].Version != 7 {
		t.Fatalf("version = %#v, want open version 7", published[1].Version)
	}
	if got := published[1].Diagnostics; len(got) != 3 ||
		got[0].Code != "lint" ||
		promptTextDiagnosticID(got[1]) != promptTextDiagnosticID(promptEarly) ||
		promptTextDiagnosticID(got[2]) != promptTextDiagnosticID(promptLate) {
		t.Fatalf("composed diagnostics = %#v, want lint then sorted PromptText", got)
	}
	if got := published[2].Diagnostics; len(got) != 1 || got[0].Code != "lint" {
		t.Fatalf("clear = %#v, want lint-only replacement", got)
	}
}

func TestPublisherSubmitsLintLaneAfterReleasingItsLock(t *testing.T) {
	t.Parallel()

	_, publisher, _, uri, _ := newViewPublisher(t)
	done := make(chan string, 2)
	publisher.options.SubmitDiagnostics = func(
		gotURI protocol.DocumentURI,
		_ []protocol.Diagnostic,
	) {
		if gotURI != uri {
			return
		}
		if _, ok := publisher.openDocumentView(uri); !ok {
			t.Error("publisher lock was released but open view was unavailable")
		}
		done <- "diagnostics"
	}
	publisher.options.OnPublish = func() {
		if _, ok := publisher.openDocumentView(uri); !ok {
			t.Error("Publisher lock was held during the publication callback")
		}
		done <- "publish"
	}
	publisher.DidOpen(uri, 1)

	for range 2 {
		select {
		case <-done:
		case <-time.After(time.Second):
			t.Fatal("publication callbacks ran under the Publisher lock")
		}
	}
}

func TestPublisherSerializesConcurrentDiagnosticSubmissions(t *testing.T) {
	t.Parallel()

	_, publisher, _, uri, _ := newViewPublisher(t)
	firstStarted := make(chan struct{})
	secondStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var mu sync.Mutex
	calls := 0
	publisher.options.SubmitDiagnostics = func(
		protocol.DocumentURI,
		[]protocol.Diagnostic,
	) {
		mu.Lock()
		calls++
		call := calls
		mu.Unlock()
		if call == 1 {
			close(firstStarted)
			<-releaseFirst
			return
		}
		close(secondStarted)
	}
	firstDone := make(chan struct{})
	go func() {
		publisher.DidOpen(uri, 1)
		close(firstDone)
	}()
	<-firstStarted
	secondDone := make(chan struct{})
	go func() {
		publisher.DidOpen(uri, 2)
		close(secondDone)
	}()

	select {
	case <-secondStarted:
		t.Fatal("second diagnostic submission overtook the first")
	case <-time.After(20 * time.Millisecond):
	}
	close(releaseFirst)
	<-firstDone
	<-secondStarted
	<-secondDone
}

func TestPromptTextDiagnosticComposerGatesLaneWithoutDroppingLint(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/writer.ts")
	revision := transient.NewRevision(1, 4, "source")
	open := true
	var published protocol.PublishDiagnosticsParams
	composer := newDiagnosticComposer(diagnosticComposerOptions{
		Document: func(protocol.DocumentURI) diagnosticDocumentState {
			return diagnosticDocumentState{
				Revision: revision,
				Version:  4,
				Exact:    open,
				Open:     open,
			}
		},
		VersionSupport: func() bool { return false },
		Publish:        func(params protocol.PublishDiagnosticsParams) { published = params },
	})
	lint := protocol.Diagnostic{Code: "lint", Message: "lint"}
	composer.SubmitLint(uri, []protocol.Diagnostic{lint})
	composer.SubmitPromptText(
		uri,
		promptTextDiagnosticStamp{Revision: revision},
		[]protocol.Diagnostic{promptTextComposerDiagnostic(t, "a", 1)},
	)
	if published.Version == nil || *published.Version != 4 ||
		len(published.Diagnostics) != 1 ||
		published.Diagnostics[0].Code != "lint" {
		t.Fatalf("unsupported version lane = %#v, want versioned lint only", published)
	}
	open = false
	composer.ClearPromptText(uri)
	if published.Version != nil || len(published.Diagnostics) != 1 {
		t.Fatalf("closed lane = %#v, want unversioned lint only", published)
	}
}

func TestPromptTextDiagnosticComposerPinsOpenVersionWhenBufferUnavailable(
	t *testing.T,
) {
	t.Parallel()

	server := New(Options{})
	server.buffers = newDocumentBuffers(documentBufferLimits{
		DocumentBytes: 4,
		ProcessBytes:  4,
	})
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	open, _ := json.Marshal(protocol.DidOpenTextDocumentParams{
		TextDocument: protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 12,
			Text: "const value = 1",
		},
	})
	server.didOpen(open)
	server.diagnostics.SubmitLint(uri, []protocol.Diagnostic{{
		Code: "lint", Message: "lint",
	}})

	message := <-server.Outbound()
	params := message.Params.(protocol.PublishDiagnosticsParams)
	if params.Version == nil || *params.Version != 12 ||
		len(params.Diagnostics) != 1 {
		t.Fatalf("unavailable open buffer publication = %#v, want version 12", params)
	}
}

func TestPromptTextDiagnosticComposerDoesNotRegressOpenVersion(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	open, _ := json.Marshal(protocol.DidOpenTextDocumentParams{
		TextDocument: protocol.TextDocumentItem{
			URI: uri, LanguageID: "typescript", Version: 12,
			Text: "const value = 1",
		},
	})
	server.didOpen(open)
	change, _ := json.Marshal(protocol.DidChangeTextDocumentParams{
		TextDocument: protocol.VersionedTextDocumentIdentifier{
			TextDocumentIdentifier: protocol.TextDocumentIdentifier{URI: uri},
			Version:                11,
		},
		ContentChanges: []protocol.TextDocumentContentChangeEvent{{
			Text: "const value = 2",
		}},
	})
	server.didChange(change)
	server.diagnostics.SubmitLint(uri, []protocol.Diagnostic{{
		Code: "lint", Message: "lint",
	}})

	message := <-server.Outbound()
	params := message.Params.(protocol.PublishDiagnosticsParams)
	if params.Version == nil || *params.Version != 12 {
		t.Fatalf("regressive publication version = %#v, want 12", params.Version)
	}
}

func promptTextComposerDiagnostic(
	t *testing.T,
	suffix string,
	line uint32,
) protocol.Diagnostic {
	t.Helper()
	id := "prompt-text:" + strings.Repeat("0", 64)
	id = id[:len(id)-1] + suffix
	data, err := json.Marshal(map[string]string{"kind": "prompt-text", "id": id})
	if err != nil {
		t.Fatal(err)
	}
	return protocol.Diagnostic{
		Range: protocol.Range{
			Start: protocol.Position{Line: line},
			End:   protocol.Position{Line: line, Character: 1},
		},
		Code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION", Message: "invalid",
		Data: data,
	}
}
