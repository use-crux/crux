package prompttext

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

func BenchmarkPromptTextSharedConformanceViews(b *testing.B) {
	fixture := readEditorConformanceFixture(b)
	document := conformanceBenchmarkDocument(fixture)
	source := &conformanceBenchmarkSource{result: fixture.Analysis}
	request := Request{
		URI: document.URI, File: fixture.Query.File, Root: "/repo",
		ScopeID: "/repo", SourceEpoch: 1, Analyzer: source,
		Views: conformanceViewProvider(
			document,
			fixture.Query.File,
			fixture.SemanticData.DefinitionID,
			fixture.SemanticData.SourceRef,
			fixture.SemanticData.Diagnostics,
		),
	}
	target := PreviewTarget{
		Kind:  PreviewTargetTemplateRange,
		Range: editorRange(fixture.Analysis.Templates[1].Range),
	}

	b.Run("cold-decoration", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			controller := NewController(&fixedDocumentSource{document: document})
			controller.Decorations(context.Background(), request)
		}
	})
	b.Run("warm-all-views", func(b *testing.B) {
		controller := NewController(&fixedDocumentSource{document: document})
		controller.Decorations(context.Background(), request)
		startCalls := source.calls.Load()
		b.ReportAllocs()
		b.ResetTimer()
		for b.Loop() {
			controller.Decorations(context.Background(), request)
			controller.Folding(context.Background(), request)
			controller.Symbols(context.Background(), request)
			controller.Links(context.Background(), request)
			controller.StaticPreview(context.Background(), request, target)
		}
		b.StopTimer()
		if calls := source.calls.Load() - startCalls; calls != 0 {
			b.Fatalf("warm compiler calls = %d, want zero", calls)
		}
		b.ReportMetric(100, "coordinator-hit-%")
	})
}

func TestPromptTextCoordinatorCancellationLatencyBound(t *testing.T) {
	t.Parallel()

	fixture := readEditorConformanceFixture(t)
	document := conformanceBenchmarkDocument(fixture)
	source := &cancellationBenchmarkSource{started: make(chan struct{})}
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: document.URI, File: fixture.Query.File, Root: "/repo",
		ScopeID: "/repo", SourceEpoch: 1, Analyzer: source,
		Views: conformanceViewProvider(
			document,
			fixture.Query.File,
			fixture.SemanticData.DefinitionID,
			fixture.SemanticData.SourceRef,
			fixture.SemanticData.Diagnostics,
		),
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		controller.Decorations(ctx, request)
	}()
	<-source.started
	started := time.Now()
	cancel()
	select {
	case <-done:
		latency := time.Since(started)
		t.Logf("coordinator cancellation latency: %s", latency)
		if latency > time.Second {
			t.Fatalf("cancellation latency = %s, want at most 1s", latency)
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation did not retire within 1s")
	}
}

func conformanceBenchmarkDocument(
	fixture editorConformanceFixture,
) transient.Document {
	return transient.Document{
		URI:        protocol.DocumentURI("file://" + fixture.Query.File),
		LanguageID: fixture.Query.LanguageID,
		Version:    1,
		Text:       fixture.Source,
		Revision:   transient.NewRevision(1, 1, fixture.Source),
	}
}

type conformanceBenchmarkSource struct {
	calls  atomic.Uint64
	result readmodel.PromptTextResult
}

func (s *conformanceBenchmarkSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *conformanceBenchmarkSource) PromptText(
	_ context.Context,
	_ readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.calls.Add(1)
	return s.result, nil
}

type cancellationBenchmarkSource struct {
	started chan struct{}
}

func (*cancellationBenchmarkSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *cancellationBenchmarkSource) PromptText(
	ctx context.Context,
	_ readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	close(s.started)
	<-ctx.Done()
	return readmodel.PromptTextResult{}, ctx.Err()
}
