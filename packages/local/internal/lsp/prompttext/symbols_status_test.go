package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerSymbolsHonorCompletenessRevisionAndHeadingValidity(t *testing.T) {
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
	tests := []struct {
		name string
		edit func(*readmodel.PromptTextResult)
		want int
	}{
		{name: "complete", edit: func(*readmodel.PromptTextResult) {}, want: 1},
		{
			name: "request truncated retains complete template",
			edit: func(result *readmodel.PromptTextResult) {
				result.Status.Kind = staticprotocol.PromptTextStatusTruncated
			},
			want: 1,
		},
		{
			name: "request unsupported",
			edit: func(result *readmodel.PromptTextResult) {
				result.Status.Kind = staticprotocol.PromptTextStatusUnsupported
			},
		},
		{
			name: "template truncated",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Status.Kind = staticprotocol.PromptTextStatusTruncated
			},
		},
		{
			name: "stale worker revision",
			edit: func(result *readmodel.PromptTextResult) {
				result.Revision = transient.NewRevision(2, 1, text)
			},
		},
		{
			name: "missing label",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Blocks[0].Label = nil
			},
		},
		{
			name: "invalid level",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Blocks[0].Level = 7
			},
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			analysis := sharedFoldingAnalysis(file, revision)
			test.edit(&analysis)
			controller := NewController(&fixedDocumentSource{document: document})
			result := controller.Symbols(context.Background(), Request{
				URI: uri, File: file, Root: "/repo", ScopeID: "/repo",
				SourceEpoch: 4, Analyzer: fixedTransientSource{result: analysis},
				Views: canonicalFoldingViews(file, text, revision.SourceHash),
			})
			if result.Symbols == nil || len(result.Symbols) != test.want {
				t.Fatalf("symbols = %#v, want non-nil length %d", result, test.want)
			}
		})
	}
}

func TestControllerSymbolsHonorCancelledContextEvenWithCachedAnalysis(t *testing.T) {
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
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: uri, File: file, Root: "/repo", ScopeID: "/repo",
		SourceEpoch: 4,
		Analyzer: fixedTransientSource{
			result: sharedFoldingAnalysis(file, revision),
		},
		Views: canonicalFoldingViews(file, text, revision.SourceHash),
	}
	if len(controller.Symbols(context.Background(), request).Symbols) != 1 {
		t.Fatal("initial symbols did not populate the shared analysis cache")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := controller.Symbols(ctx, request)
	if result.Symbols == nil || len(result.Symbols) != 0 {
		t.Fatalf("cancelled symbols = %#v, want non-nil empty", result)
	}
}
