package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerFoldingHonorsRequestAndTemplateCompleteness(t *testing.T) {
	t.Parallel()

	const (
		file = "/repo/src/writer.ts"
		text = "const value = md`# Title\nbody\n`;\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	revision := transient.NewRevision(1, 1, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
		Revision: revision,
	}
	base := foldingStatusResult(file, revision)
	tests := []struct {
		name string
		edit func(*readmodel.PromptTextResult)
		want int
	}{
		{
			name: "request complete",
			edit: func(*readmodel.PromptTextResult) {},
			want: 1,
		},
		{
			name: "request truncated retains complete included template",
			edit: func(result *readmodel.PromptTextResult) {
				result.Status.Kind = staticprotocol.PromptTextStatusTruncated
			},
			want: 1,
		},
		{
			name: "request unsupported clears",
			edit: func(result *readmodel.PromptTextResult) {
				result.Status.Kind = staticprotocol.PromptTextStatusUnsupported
			},
			want: 0,
		},
		{
			name: "template truncated suppresses incomplete structure",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Status.Kind = staticprotocol.PromptTextStatusTruncated
			},
			want: 0,
		},
		{
			name: "stale worker revision clears",
			edit: func(result *readmodel.PromptTextResult) {
				result.Revision = transient.NewRevision(2, 1, text)
			},
			want: 0,
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			result := base
			result.Templates = append(
				[]staticprotocol.PromptTextTemplate(nil),
				base.Templates...,
			)
			test.edit(&result)
			controller := NewController(&fixedDocumentSource{document: document})
			got := controller.Folding(context.Background(), Request{
				URI: uri, File: file, ScopeID: "/repo", SourceEpoch: 1,
				Analyzer: fixedTransientSource{result: result},
			})
			if got.Ranges == nil || len(got.Ranges) != test.want {
				t.Fatalf("folding ranges = %#v, want non-nil length %d", got.Ranges, test.want)
			}
		})
	}
}

func foldingStatusResult(
	file string,
	revision transient.Revision,
) readmodel.PromptTextResult {
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        revision,
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
	}
}
