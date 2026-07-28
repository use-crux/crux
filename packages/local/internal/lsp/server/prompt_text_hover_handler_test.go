package server

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestPromptTextHoverHandlerComposesTransformedDefinitionBeforePromptText(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/source.ts")
	server := New(Options{})
	server.hoverFormat = protocol.MarkupKindMarkdown
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 3,
		Text: "const value = md`hello`",
	})
	document, _ := server.buffers.Snapshot(uri)
	workspace := &hoverPromptTextWorkspace{result: lsprompttext.HoverResult{
		Revision: document.Revision,
		PromptTextHover: lsprompttext.PromptTextHover{
			Handled: true, Claimed: true,
			Range: protocol.Range{
				Start: protocol.Position{Character: 17},
				End:   protocol.Position{Character: 22},
			},
			Owners: []promptview.Definition{{
				ID: "prompt:writer", Name: "Writer", Kind: "prompt",
				Location: promptview.Location{
					File: "/repo/source.ts",
					Range: protocol.Range{
						Start: protocol.Position{},
						End:   protocol.Position{Character: 24},
					},
				},
			}},
			TemplateLabel: "direct `prompt` template",
			Lifecycle:     "static", LiteralCount: 1,
			Evidence: "exact semantic view",
		},
	}}
	server.workspace = workspace
	response := server.Handle(context.Background(), protocol.Request{
		ID: []byte("hover"), Method: protocol.MethodHover,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"position":{"line":0,"character":18}
		}`),
	})
	if response.Deferred == nil {
		t.Fatal("PromptText hover was not deferred")
	}
	resolved := response.Deferred()
	hover, ok := resolved.Result.(*protocol.Hover)
	if resolved.Error != nil || !ok {
		t.Fatalf("hover result = %#v", resolved)
	}
	definitionIndex := strings.Index(hover.Contents.Value, "**Writer**")
	promptTextIndex := strings.Index(hover.Contents.Value, "**Crux PromptText**")
	if definitionIndex < 0 || promptTextIndex <= definitionIndex ||
		workspace.legacyCalls != 0 {
		t.Fatalf("hover content = %q, legacy calls=%d", hover.Contents.Value, workspace.legacyCalls)
	}
	wantDefinitionRange := workspace.result.Owners[0].Location.Range
	if hover.Range == nil || *hover.Range != wantDefinitionRange {
		t.Fatalf("hover range = %#v, want existing definition %#v", hover.Range, wantDefinitionRange)
	}

	workspace.result = lsprompttext.HoverResult{
		Revision: document.Revision,
		PromptTextHover: lsprompttext.PromptTextHover{
			Handled: true,
		},
	}
	workspace.legacyDefinition = &definitionSummary{
		Definition: documentDefinition{
			Definition: api.ProjectDefinition{
				ID: "prompt:writer", Name: "Writer", Kind: "prompt",
			},
			Range: protocol.Range{
				Start: protocol.Position{},
				End:   protocol.Position{Character: 24},
			},
		},
	}
	response = server.Handle(context.Background(), protocol.Request{
		ID: []byte("barrier-hover"), Method: protocol.MethodHover,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/source.ts"},
			"position":{"line":0,"character":18}
		}`),
	})
	resolved = response.Deferred()
	hover, ok = resolved.Result.(*protocol.Hover)
	if resolved.Error != nil || !ok ||
		!strings.Contains(hover.Contents.Value, "**Writer**") ||
		hover.Range == nil ||
		*hover.Range != workspace.legacyDefinition.Definition.Range ||
		workspace.legacyCalls != 1 {
		t.Fatalf("barrier hover = %#v, legacy calls=%d", resolved, workspace.legacyCalls)
	}
}

type hoverPromptTextWorkspace struct {
	workspaceController
	result           lsprompttext.HoverResult
	legacyDefinition *definitionSummary
	legacyCalls      int
}

func (w *hoverPromptTextWorkspace) PromptTextHover(
	context.Context,
	protocol.DocumentURI,
	string,
	protocol.Position,
) lsprompttext.HoverResult {
	return w.result
}

func (*hoverPromptTextWorkspace) DisplayedFindings(
	protocol.DocumentURI,
	protocol.Position,
) []displayedFinding {
	return nil
}

func (w *hoverPromptTextWorkspace) HoverAt(
	protocol.DocumentURI,
	protocol.Position,
) ([]displayedFinding, *definitionSummary) {
	w.legacyCalls++
	return nil, w.legacyDefinition
}
