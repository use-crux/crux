package transient

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestCoordinatorKeepsSharedAnalysisForRemainingWaiter(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "md`# Hello`",
		Revision: NewRevision(1, 1, "md`# Hello`"),
	}
	source := &mutableDocumentSource{document: document}
	analyzer := &sharedWaiterTransientSource{
		started: make(chan struct{}), release: make(chan struct{}),
	}
	coordinator := NewCoordinator(source)
	query := Query{
		URI: uri, File: "/repo/src/writer.ts", ScopeID: "/repo",
		SourceEpoch: 3, Analyzer: analyzer,
	}
	firstContext, cancelFirst := context.WithCancel(context.Background())
	firstDone := make(chan error, 1)
	secondDone := make(chan error, 1)
	go func() {
		_, err := coordinator.Analyze(firstContext, query)
		firstDone <- err
	}()
	<-analyzer.started
	go func() {
		_, err := coordinator.Analyze(context.Background(), query)
		secondDone <- err
	}()
	waitForCoordinatorWaiters(t, coordinator, 2)

	cancelFirst()
	if err := <-firstDone; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled waiter error = %v, want context.Canceled", err)
	}
	close(analyzer.release)
	if err := <-secondDone; err != nil {
		t.Fatalf("remaining waiter error = %v, want success", err)
	}
	if analyzer.callCount() != 1 {
		t.Fatalf("analysis calls = %d, want one shared invocation", analyzer.callCount())
	}
}

func TestCoordinatorDoesNotRetryAnalyzerCancellationWithoutAJoinedWaiter(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "md`# Hello`",
		Revision: NewRevision(1, 1, "md`# Hello`"),
	}
	analyzer := &cancelledTransientSource{}
	coordinator := NewCoordinator(&mutableDocumentSource{document: document})

	_, err := coordinator.Analyze(context.Background(), Query{
		URI: uri, File: "/repo/src/writer.ts", ScopeID: "/repo",
		SourceEpoch: 3, Analyzer: analyzer,
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("analysis error = %v, want context.Canceled", err)
	}
	if analyzer.calls != 1 {
		t.Fatalf("analysis calls = %d, want no implicit retry", analyzer.calls)
	}
}

type sharedWaiterTransientSource struct {
	mu      sync.Mutex
	calls   int
	started chan struct{}
	release chan struct{}
}

func (*sharedWaiterTransientSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *sharedWaiterTransientSource) PromptText(
	ctx context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.mu.Lock()
	s.calls++
	call := s.calls
	if call == 1 {
		close(s.started)
	}
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return readmodel.PromptTextResult{}, ctx.Err()
	case <-s.release:
		return exactPromptTextResult(request), nil
	}
}

func (s *sharedWaiterTransientSource) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

type cancelledTransientSource struct {
	calls int
}

func (*cancelledTransientSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *cancelledTransientSource) PromptText(
	context.Context,
	readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.calls++
	return readmodel.PromptTextResult{}, context.Canceled
}
