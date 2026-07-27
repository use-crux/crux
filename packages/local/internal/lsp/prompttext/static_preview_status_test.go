package prompttext

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerStaticPreviewReturnsEveryUnavailableStatus(t *testing.T) {
	t.Parallel()

	const text = "01234567890123456789"
	uri := protocol.DocumentURI("file:///repo/writer.ts")
	revision := transient.NewRevision(2, 7, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 7, Text: text,
		Revision: revision,
	}
	sourceRange := previewRange(0, 2, 0, 8)
	ready := readyPreviewTemplate(1, sourceRange, "ready")
	unsupported := ready
	unsupported.Status.Kind = staticprotocol.PromptTextStatusUnsupported
	unavailable := ready
	unavailable.Preview.Status.Kind = staticprotocol.PromptTextPreviewUnavailable
	unavailable.Preview.Evidence = nil
	duplicate := readyPreviewTemplate(2, sourceRange, "duplicate")

	tests := []struct {
		name      string
		status    staticprotocol.PromptTextStatusKind
		templates []staticprotocol.PromptTextTemplate
		target    PreviewTarget
		reason    string
	}{
		{
			name: "request unsupported", status: staticprotocol.PromptTextStatusUnsupported,
			reason: "request-unsupported",
		},
		{
			name: "template not found", status: staticprotocol.PromptTextStatusComplete,
			reason: "template-not-found",
		},
		{
			name: "template ambiguous", status: staticprotocol.PromptTextStatusComplete,
			templates: []staticprotocol.PromptTextTemplate{ready, duplicate},
			target: PreviewTarget{
				Kind: PreviewTargetTemplateRange, Range: editorRange(sourceRange),
			},
			reason: "template-ambiguous",
		},
		{
			name: "template unsupported", status: staticprotocol.PromptTextStatusComplete,
			templates: []staticprotocol.PromptTextTemplate{unsupported},
			reason:    "template-unsupported",
		},
		{
			name: "preview unavailable", status: staticprotocol.PromptTextStatusComplete,
			templates: []staticprotocol.PromptTextTemplate{unavailable},
			reason:    "preview-unavailable",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			controller := NewController(&fixedDocumentSource{document: document})
			result := readmodel.PromptTextResult{
				ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
				File:            "/repo/writer.ts",
				Revision:        revision,
				Status: staticprotocol.PromptTextAnalysisStatus{
					Kind: test.status,
				},
				Templates: test.templates,
			}
			target := test.target
			if target.Kind == "" {
				target = PreviewTarget{
					Kind:     PreviewTargetPosition,
					Position: protocol.Position{Character: 4},
				}
			}
			got := controller.StaticPreview(context.Background(), Request{
				URI: uri, File: result.File, ScopeID: "/repo", SourceEpoch: 1,
				Analyzer: fixedTransientSource{result: result},
			}, target)
			if got.Kind != PreviewResultUnavailable ||
				got.Revision != revision ||
				got.Reason != test.reason {
				t.Fatalf("static preview = %#v", got)
			}
		})
	}

	controller := NewController(&fixedDocumentSource{document: document})
	got := controller.StaticPreview(context.Background(), Request{
		URI: uri, File: "/repo/writer.ts", ScopeID: "/repo",
	}, PreviewTarget{Kind: PreviewTargetPosition})
	if got.Kind != PreviewResultUnavailable ||
		got.Revision != revision ||
		got.Reason != "analysis-unavailable" {
		t.Fatalf("missing analyzer preview = %#v", got)
	}
}
