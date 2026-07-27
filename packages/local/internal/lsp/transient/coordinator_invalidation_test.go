package transient

import (
	"context"
	"errors"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestCoordinatorInvalidationRetiresCachedDocumentAnalysis(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "md`# Hello`",
		Revision: NewRevision(1, 1, "md`# Hello`"),
	}
	analyzer := &recordingTransientSource{}
	coordinator := NewCoordinator(&mutableDocumentSource{document: document})
	query := Query{
		URI: uri, File: "/repo/src/writer.ts", ScopeID: "/repo",
		SourceEpoch: 3, Analyzer: analyzer,
	}

	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	if analyzer.calls != 1 {
		t.Fatalf("cached analysis calls = %d, want one", analyzer.calls)
	}

	coordinator.Invalidate(uri)
	if _, err := coordinator.Analyze(context.Background(), query); err != nil {
		t.Fatal(err)
	}
	if analyzer.calls != 2 {
		t.Fatalf("post-invalidation calls = %d, want fresh analysis", analyzer.calls)
	}
}

func TestCoordinatorInvalidationSupersedesInflightDocumentAnalysis(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: "md`# Hello`",
		Revision: NewRevision(1, 1, "md`# Hello`"),
	}
	analyzer := &blockingTransientSource{
		started: make(chan struct{}), release: make(chan struct{}),
	}
	coordinator := NewCoordinator(&mutableDocumentSource{document: document})
	done := make(chan error, 1)
	go func() {
		_, err := coordinator.Analyze(context.Background(), Query{
			URI: uri, File: "/repo/src/writer.ts", ScopeID: "/repo",
			SourceEpoch: 3, Analyzer: analyzer,
		})
		done <- err
	}()
	<-analyzer.started

	coordinator.Invalidate(uri)
	if err := <-done; !errors.Is(err, ErrSuperseded) {
		t.Fatalf("invalidated analysis error = %v, want ErrSuperseded", err)
	}
}
