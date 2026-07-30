package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextDocumentLinkControllerFailsClosedOnInvalidEvidence(t *testing.T) {
	t.Parallel()

	const (
		root = "/repo"
		file = "/repo/src/writer.ts"
		text = "const value = md`[guide](https://example.com)`;\n"
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
			name: "unknown request status",
			edit: func(result *readmodel.PromptTextResult) {
				result.Status.Kind = "future-status"
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
			name: "zero width text range",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Links[0].TextRange.End =
					result.Templates[0].Links[0].TextRange.Start
			},
		},
		{
			name: "unknown island",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Links[0].Island = 7
			},
		},
		{
			name: "out of island",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Links[0].TextRange =
					staticRange(0, 14, 0, 16)
			},
		},
		{
			name: "text range outside parser construct",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Links[0].Range =
					staticRange(0, 24, 0, 30)
			},
		},
		{
			name: "invalid parser construct range",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Links[0].Range.End =
					result.Templates[0].Links[0].Range.Start
			},
		},
		{
			name: "barrier crossing",
			edit: func(result *readmodel.PromptTextResult) {
				textRange := result.Templates[0].Links[0].TextRange
				result.Templates[0].InterpolationBarriers =
					[]staticprotocol.PromptTextInterpolationBarrier{{
						Index: 0, Range: textRange, ExpressionRange: textRange,
					}}
			},
		},
		{
			name: "unknown link kind",
			edit: func(result *readmodel.PromptTextResult) {
				result.Templates[0].Links[0].Kind = "future-link"
			},
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()

			analysis := linkAnalysis(file, text, revision, []linkFixture{{
				label: "guide", destination: "https://example.com",
			}})
			test.edit(&analysis)
			controller := NewController(&fixedDocumentSource{document: document})
			result := controller.Links(context.Background(), Request{
				URI: uri, File: file, Root: root, ScopeID: root,
				SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
				Views: canonicalLinkViews(root, file, text, revision.SourceHash),
			})
			if result.Links == nil || len(result.Links) != test.want {
				t.Fatalf("links = %#v, want non-nil length %d", result, test.want)
			}
		})
	}
}

func TestPromptTextDocumentLinkControllerHonorsCachedCancellation(t *testing.T) {
	t.Parallel()

	const (
		root = "/repo"
		file = "/repo/src/writer.ts"
		text = "const value = md`[guide](https://example.com)`;\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	revision := transient.NewRevision(1, 1, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
		Revision: revision,
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: uri, File: file, Root: root, ScopeID: root, SourceEpoch: 1,
		Analyzer: fixedTransientSource{result: linkAnalysis(
			file,
			text,
			revision,
			[]linkFixture{{label: "guide", destination: "https://example.com"}},
		)},
		Views: canonicalLinkViews(root, file, text, revision.SourceHash),
	}
	if len(controller.Links(context.Background(), request).Links) != 1 {
		t.Fatal("initial links did not populate the shared analysis cache")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := controller.Links(ctx, request)
	if result.Links == nil || len(result.Links) != 0 {
		t.Fatalf("cancelled links = %#v, want non-nil empty", result)
	}
}
