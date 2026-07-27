package prompttext

import (
	"context"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerSharedAnalysisAcrossDecorationsFoldingAndSymbols(t *testing.T) {
	t.Parallel()

	const (
		file = "/repo/src/writer.ts"
		text = "const value = md`# Title\n> quote\n> - first\n> - second\n${name}\n> after\n> again\n`;\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	revision := transient.NewRevision(1, 1, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
		Revision: revision,
	}
	analysis := sharedFoldingAnalysis(file, revision)
	analyzer := &sharedFoldingSource{
		started: make(chan struct{}), release: make(chan struct{}),
		result: analysis,
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: uri, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 4, Analyzer: analyzer,
		Views: canonicalFoldingViews(file, text, revision.SourceHash),
	}

	var (
		decorations Result
		folding     FoldingResult
		symbols     SymbolResult
		wait        sync.WaitGroup
	)
	wait.Add(3)
	go func() {
		defer wait.Done()
		decorations = controller.Decorations(context.Background(), request)
	}()
	go func() {
		defer wait.Done()
		folding = controller.Folding(context.Background(), request)
	}()
	go func() {
		defer wait.Done()
		symbols = controller.Symbols(context.Background(), request)
	}()
	<-analyzer.started
	close(analyzer.release)
	wait.Wait()

	if analyzer.callCount() != 1 {
		t.Fatalf("analysis calls = %d, want one shared call", analyzer.callCount())
	}
	if len(decorations.Decorations) != 1 {
		t.Fatalf("decorations = %#v, want one canonical heading", decorations)
	}
	want := []protocol.FoldingRange{
		{StartLine: 0, EndLine: 3},
		{StartLine: 1, EndLine: 3},
		{StartLine: 2, EndLine: 3},
		{StartLine: 5, EndLine: 6},
	}
	if folding.Revision != revision || !equalFoldingRanges(folding.Ranges, want) {
		t.Fatalf("folding = %#v, want revision %#v and ranges %#v", folding, revision, want)
	}
	if folding.evidence != foldingEvidenceLexical {
		t.Fatalf("folding evidence = %q, want explicitly lexical", folding.evidence)
	}
	if symbols.Revision != revision || len(symbols.Symbols) != 1 ||
		symbols.Symbols[0].Name != "Title" {
		t.Fatalf("symbols = %#v, want exact revision and canonical heading", symbols)
	}
}

func sharedFoldingAnalysis(
	file string,
	revision transient.Revision,
) readmodel.PromptTextResult {
	rangeAt := func(startLine, startCharacter, endLine, endCharacter uint32) staticprotocol.PromptTextRange {
		return staticprotocol.PromptTextRange{
			Start: staticprotocol.PromptTextPosition{Line: startLine, Character: startCharacter},
			End:   staticprotocol.PromptTextPosition{Line: endLine, Character: endCharacter},
		}
	}
	headingText := rangeAt(0, 19, 0, 24)
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			CandidateID: 0,
			Range:       rangeAt(0, 14, 7, 1),
			TagRange:    rangeAt(0, 14, 0, 16),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{
				{Index: 0, Range: rangeAt(0, 17, 4, 0)},
				{Index: 1, Range: rangeAt(4, 7, 7, 0)},
			},
			InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{{
				Index: 0, Range: rangeAt(4, 0, 4, 7),
				ExpressionRange: rangeAt(4, 2, 4, 6),
			}},
			Blocks: []staticprotocol.PromptTextBlock{
				{
					Kind: staticprotocol.PromptTextBlockHeading, Index: 0, Island: 0,
					Level: 1, Label: promptTextLabel("Title"),
					Range: rangeAt(0, 17, 1, 0), TextRange: &headingText,
				},
				{
					Kind: staticprotocol.PromptTextBlockBlockquote, Index: 1, Island: 0,
					Range: rangeAt(1, 0, 4, 0),
				},
				{
					Kind: staticprotocol.PromptTextBlockList, Index: 2, Island: 0,
					Range: rangeAt(2, 2, 4, 0),
				},
				{
					Kind: staticprotocol.PromptTextBlockBlockquote, Index: 3, Island: 1,
					Range: rangeAt(5, 0, 7, 0),
				},
			},
		}},
	}
}

func promptTextLabel(value string) *string { return &value }

func canonicalFoldingViews(
	file, source, sourceHash string,
) indexview.ViewProvider {
	generation := uint64(4)
	store := readmodel.NewStore()
	store.ApplySnapshot("/repo", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:writer",
			SourceRefs: []api.ProjectSourceRef{{
				ID:     "prompt:writer:source:prompt:prompt-text",
				Source: api.SourceLoc{File: file, Line: 1, Column: intPointer(15)},
				Snippet: &api.SourceSnippet{
					Source: source[14 : len(source)-2], Language: "typescript",
					Range: api.SourceRange{
						File: file, StartLine: 1, StartColumn: intPointer(15),
						EndLine: intPointer(8), EndColumn: intPointer(2),
					},
				},
				Fidelity: "resolved",
				Metadata: map[string]any{"promptText": map[string]any{
					"tag": "md", "language": "markdown", "lifecycle": "static",
				}},
			}},
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: sourceHash,
		}},
	})
	return indexview.NewSavedProvider(store)
}

type sharedFoldingSource struct {
	mu      sync.Mutex
	calls   int
	started chan struct{}
	release chan struct{}
	result  readmodel.PromptTextResult
}

func (s *sharedFoldingSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *sharedFoldingSource) PromptText(
	ctx context.Context,
	_ readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.mu.Lock()
	s.calls++
	if s.calls == 1 {
		close(s.started)
	}
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return readmodel.PromptTextResult{}, ctx.Err()
	case <-s.release:
		return s.result, nil
	}
}

func (s *sharedFoldingSource) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func equalFoldingRanges(left, right []protocol.FoldingRange) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
