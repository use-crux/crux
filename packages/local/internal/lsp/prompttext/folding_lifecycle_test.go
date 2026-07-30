package prompttext

import (
	"context"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerFoldingCloseReopenUsesNewOpenEpoch(t *testing.T) {
	t.Parallel()

	const (
		file = "/repo/src/writer.ts"
		text = "const value = md`# Héllo\r\nbody\r\n`;\r\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	documents := &foldingLifecycleDocuments{
		available: true,
		document: transient.Document{
			URI: uri, LanguageID: "typescript", Version: 1, Text: text,
			Revision: transient.NewRevision(1, 1, text),
		},
	}
	analyzer := &foldingLifecycleAnalyzer{}
	controller := NewController(documents)
	request := Request{
		URI: uri, File: file, ScopeID: "/repo", SourceEpoch: 3,
		Analyzer: analyzer,
	}

	first := controller.Folding(context.Background(), request)
	if first.Revision.OpenEpoch != 1 || len(first.Ranges) != 1 {
		t.Fatalf("first folding = %#v, want epoch 1 and one range", first)
	}

	documents.close()
	closed := controller.Folding(context.Background(), request)
	if closed.Ranges == nil || len(closed.Ranges) != 0 {
		t.Fatalf("closed folding = %#v, want non-nil empty result", closed)
	}

	documents.reopen(transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
		Revision: transient.NewRevision(2, 1, text),
	})
	reopened := controller.Folding(context.Background(), request)
	if reopened.Revision.OpenEpoch != 2 || len(reopened.Ranges) != 1 {
		t.Fatalf("reopened folding = %#v, want epoch 2 and one range", reopened)
	}
	if analyzer.callCount() != 2 {
		t.Fatalf("analysis calls = %d, want one per open epoch", analyzer.callCount())
	}
}

func TestControllerInvalidationRetiresCompletedFoldingAnalysis(t *testing.T) {
	t.Parallel()

	const (
		file = "/repo/src/writer.ts"
		text = "const value = md`# Title\nbody\n`;\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	documents := &foldingLifecycleDocuments{
		available: true,
		document: transient.Document{
			URI: uri, LanguageID: "typescript", Version: 1, Text: text,
			Revision: transient.NewRevision(1, 1, text),
		},
	}
	analyzer := &foldingLifecycleAnalyzer{}
	controller := NewController(documents)
	request := Request{
		URI: uri, File: file, ScopeID: "/repo", SourceEpoch: 3,
		Analyzer: analyzer,
	}

	if len(controller.Folding(context.Background(), request).Ranges) != 1 ||
		len(controller.Folding(context.Background(), request).Ranges) != 1 {
		t.Fatal("cached folding did not return one range")
	}
	if analyzer.callCount() != 1 {
		t.Fatalf("cached analysis calls = %d, want one", analyzer.callCount())
	}
	controller.Invalidate(uri)
	if len(controller.Folding(context.Background(), request).Ranges) != 1 {
		t.Fatal("fresh folding did not return one range")
	}
	if analyzer.callCount() != 2 {
		t.Fatalf("post-invalidation calls = %d, want fresh analysis", analyzer.callCount())
	}
}

type foldingLifecycleDocuments struct {
	mu        sync.Mutex
	document  transient.Document
	available bool
}

func (s *foldingLifecycleDocuments) Snapshot(
	uri protocol.DocumentURI,
) (transient.Document, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.available {
		return transient.Document{}, false
	}
	return s.document, s.document.URI == uri
}

func (s *foldingLifecycleDocuments) close() {
	s.mu.Lock()
	s.available = false
	s.document = transient.Document{}
	s.mu.Unlock()
}

func (s *foldingLifecycleDocuments) reopen(document transient.Document) {
	s.mu.Lock()
	s.document = document
	s.available = true
	s.mu.Unlock()
}

type foldingLifecycleAnalyzer struct {
	mu    sync.Mutex
	calls int
}

func (*foldingLifecycleAnalyzer) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *foldingLifecycleAnalyzer) PromptText(
	_ context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File,
		Revision:        request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			TagRange: foldingSourceRange(0, 14, 0, 16),
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
				Index: 0, Range: foldingSourceRange(0, 17, 2, 0),
			}},
			Blocks: []staticprotocol.PromptTextBlock{{
				Kind: staticprotocol.PromptTextBlockHeading, Island: 0, Level: 1,
				Range: foldingSourceRange(0, 17, 1, 0),
			}},
		}},
	}, nil
}

func (s *foldingLifecycleAnalyzer) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}
