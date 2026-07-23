package server

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestBuildInlayHintsFiltersRangeAndFindinglessDefinitions(t *testing.T) {
	t.Parallel()

	summaries := []definitionSummary{
		{
			Definition: documentDefinition{
				Definition:   api.ProjectDefinition{Name: "Writer", Kind: "prompt", Description: "Writes *text*."},
				FirstLineEnd: protocol.Position{Line: 2, Character: 14},
			},
			FindingCount: 1, IncomingRelations: 2,
		},
		{
			Definition: documentDefinition{
				Definition:   api.ProjectDefinition{Name: "Clean", Kind: "tool"},
				FirstLineEnd: protocol.Position{Line: 3, Character: 10},
			},
		},
		{
			Definition: documentDefinition{
				Definition:   api.ProjectDefinition{Name: "Outside", Kind: "agent"},
				FirstLineEnd: protocol.Position{Line: 8, Character: 5},
			},
			FindingCount: 2,
		},
	}
	hints := buildInlayHints(summaries, protocol.Range{
		Start: protocol.Position{Line: 1}, End: protocol.Position{Line: 5},
	})
	if len(hints) != 1 {
		t.Fatalf("hints = %#v, want only findingful in-range definition", hints)
	}
	hint := hints[0]
	if hint.Position != summaries[0].Definition.FirstLineEnd || hint.Label != "⚑ 1 finding" || !hint.PaddingLeft {
		t.Fatalf("hint = %#v", hint)
	}
	if hint.Tooltip == nil || hint.Tooltip.Kind != protocol.MarkupKindMarkdown ||
		hint.Tooltip.Value != "**Writer** — prompt\n\nWrites \\*text\\*.\n\n1 finding · 2 incoming · 0 outgoing relations" {
		t.Fatalf("hint tooltip = %#v", hint.Tooltip)
	}
}

func TestInlayHintHandlerHonorsSettingAndReturnsArrays(t *testing.T) {
	t.Parallel()

	want := protocol.InlayHint{Position: protocol.Position{Line: 2}, Label: "⚑ 1 finding"}
	workspace := &inlayWorkspace{hints: []protocol.InlayHint{want}}
	server := New(Options{})
	server.workspace = workspace
	result := server.Handle(context.Background(), inlayRequest("1"))
	hints, ok := result.Result.([]protocol.InlayHint)
	if result.Error != nil || !ok || len(hints) != 1 || hints[0] != want {
		t.Fatalf("enabled inlay result = %#v, error %#v", result.Result, result.Error)
	}

	server.settings.InlayHintsEnabled = false
	result = server.Handle(context.Background(), inlayRequest("2"))
	hints, ok = result.Result.([]protocol.InlayHint)
	if result.Error != nil || !ok || hints == nil || len(hints) != 0 {
		t.Fatalf("disabled inlay result = %#v, error %#v", result.Result, result.Error)
	}
}

func TestInlayHintHandlerRejectsMissingURI(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte("1"), Method: protocol.MethodInlayHint,
		Params: []byte(`{"textDocument":{},"range":{"start":{"line":0,"character":0},"end":{"line":1,"character":0}}}`),
	})
	if result.Error == nil || result.Error.Code != protocol.InvalidParamsCode {
		t.Fatalf("missing URI result = %#v, want invalid params", result)
	}
}

func inlayRequest(id string) protocol.Request {
	return protocol.Request{
		JSONRPC: protocol.JSONRPCVersion, ID: []byte(id), Method: protocol.MethodInlayHint,
		Params: []byte(`{
			"textDocument":{"uri":"file:///repo/src/a.ts"},
			"range":{"start":{"line":0,"character":0},"end":{"line":20,"character":0}}
		}`),
	}
}

type inlayWorkspace struct {
	hoverWorkspace
	hints []protocol.InlayHint
}

func (w *inlayWorkspace) InlayHints(protocol.DocumentURI, protocol.Range) []protocol.InlayHint {
	return append([]protocol.InlayHint(nil), w.hints...)
}
