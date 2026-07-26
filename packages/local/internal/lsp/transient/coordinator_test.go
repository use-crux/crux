package transient

import (
	"context"
	"errors"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestCoordinatorRejectsResultAfterDocumentRevisionChanges(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	source := &mutableDocumentSource{document: Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "md`# First`",
		Revision: NewRevision(1, 1, "md`# First`"),
	}}
	analyzer := &blockingTransientSource{
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	coordinator := NewCoordinator(source)
	done := make(chan error, 1)
	go func() {
		_, err := coordinator.Analyze(context.Background(), Query{
			URI: uri, File: "/repo/src/writer.ts", ScopeID: "/repo",
			SourceEpoch: 3, Analyzer: analyzer,
		})
		done <- err
	}()

	<-analyzer.started
	source.set(Document{
		URI: uri, LanguageID: "typescript", Version: 2, Text: "md`# Second`",
		Revision: NewRevision(1, 2, "md`# Second`"),
	})
	close(analyzer.release)

	if err := <-done; !errors.Is(err, ErrSuperseded) {
		t.Fatalf("late analysis error = %v, want ErrSuperseded", err)
	}
}

func TestCoordinatorRetriesSameRevisionAfterPreviousCallerCancels(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "md`# Hello`",
		Revision: NewRevision(1, 1, "md`# Hello`"),
	}
	source := &mutableDocumentSource{document: document}
	analyzer := &cancelThenSucceedTransientSource{
		started:      make(chan struct{}),
		cancelled:    make(chan struct{}),
		releaseFirst: make(chan struct{}),
	}
	coordinator := NewCoordinator(source)
	query := Query{
		URI: uri, File: "/repo/src/writer.ts", ScopeID: "/repo",
		SourceEpoch: 3, Analyzer: analyzer,
	}
	firstContext, cancelFirst := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	go func() {
		_, err := coordinator.Analyze(firstContext, query)
		firstDone <- err
	}()
	<-analyzer.started
	cancelFirst()
	<-analyzer.cancelled

	secondDone := make(chan error, 1)
	go func() {
		_, err := coordinator.Analyze(context.Background(), query)
		secondDone <- err
	}()
	waitForCoordinatorWaiter(t, coordinator)
	close(analyzer.releaseFirst)
	if err := <-firstDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("first analysis error = %v, want context.Canceled", err)
	}
	if err := <-secondDone; err != nil {
		t.Fatalf("replacement analysis error = %v, want success", err)
	}
}

func waitForCoordinatorWaiter(t *testing.T, coordinator *Coordinator) {
	t.Helper()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		coordinator.mu.Lock()
		waiting := coordinator.inflight != nil && coordinator.inflight.waiters > 0
		coordinator.mu.Unlock()
		if waiting {
			return
		}
		runtime.Gosched()
	}
	t.Fatal("replacement analysis did not join the cancelled in-flight call")
}

type mutableDocumentSource struct {
	mu       sync.Mutex
	document Document
}

func (s *mutableDocumentSource) Snapshot(uri protocol.DocumentURI) (Document, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.document, s.document.URI == uri
}

func (s *mutableDocumentSource) set(document Document) {
	s.mu.Lock()
	s.document = document
	s.mu.Unlock()
}

type blockingTransientSource struct {
	started chan struct{}
	release chan struct{}
}

type cancelThenSucceedTransientSource struct {
	mu           sync.Mutex
	calls        int
	started      chan struct{}
	cancelled    chan struct{}
	releaseFirst chan struct{}
}

func (*cancelThenSucceedTransientSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *cancelThenSucceedTransientSource) PromptText(
	ctx context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.mu.Lock()
	s.calls++
	call := s.calls
	s.mu.Unlock()
	if call == 1 {
		close(s.started)
		<-ctx.Done()
		close(s.cancelled)
		<-s.releaseFirst
		return readmodel.PromptTextResult{}, ctx.Err()
	}
	return exactPromptTextResult(request), nil
}

func (*blockingTransientSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *blockingTransientSource) PromptText(
	ctx context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	close(s.started)
	select {
	case <-ctx.Done():
		return readmodel.PromptTextResult{}, ctx.Err()
	case <-s.release:
	}
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File,
		Revision:        request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{},
	}, nil
}

func exactPromptTextResult(
	request readmodel.PromptTextRequest,
) readmodel.PromptTextResult {
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File,
		Revision:        request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{},
	}
}
