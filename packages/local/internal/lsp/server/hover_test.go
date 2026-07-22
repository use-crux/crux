package server

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestHoverReturnsNullWhenNoDisplayedDiagnosticMatches(t *testing.T) {
	t.Parallel()

	server := New(Options{})
	server.workspace = &hoverWorkspace{}
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodHover,
		Params:  []byte(`{"textDocument":{"uri":"file:///repo/src/a.ts"},"position":{"line":3,"character":4}}`),
	})
	if result.Error != nil || result.Result != nil {
		t.Fatalf("hover miss result = %#v, error %#v; want null", result.Result, result.Error)
	}
}

func TestHoverReturnsRenderedDisplayedFindingsAndFirstRange(t *testing.T) {
	t.Parallel()

	findings := []displayedFinding{
		hoverFinding("bravo", "Bravo"),
		hoverFinding("alpha", "Alpha"),
	}
	server := New(Options{})
	server.workspace = &hoverWorkspace{findings: findings}
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("initialize"),
		Method:  protocol.MethodInitialize,
		Params: []byte(`{
			"capabilities":{"textDocument":{"hover":{"contentFormat":["markdown"]}}}
		}`),
	})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodHover,
		Params:  []byte(`{"textDocument":{"uri":"file:///repo/src/a.ts"},"position":{"line":2,"character":5}}`),
	})
	hover, ok := result.Result.(*protocol.Hover)
	if result.Error != nil || !ok {
		t.Fatalf("hover result = %#v, error %#v", result.Result, result.Error)
	}
	if hover.Contents.Kind != protocol.MarkupKindMarkdown || !strings.HasPrefix(hover.Contents.Value, "**Alpha**") {
		t.Fatalf("hover contents = %#v, want sorted markdown", hover.Contents)
	}
	if hover.Range == nil || *hover.Range != findings[1].Diagnostic.Range {
		t.Fatalf("hover range = %#v, want first sorted range %#v", hover.Range, findings[1].Diagnostic.Range)
	}
}

func TestHoverReturnsDefinitionWithoutFindingAtCursor(t *testing.T) {
	t.Parallel()

	summary := definitionSummary{Definition: documentDefinition{
		Definition: api.ProjectDefinition{ID: "prompt:writer", Name: "Writer", Kind: "prompt"},
		Range: protocol.Range{
			Start: protocol.Position{Line: 2, Character: 4},
			End:   protocol.Position{Line: 5, Character: 1},
		},
	}, IncomingRelations: 1}
	server := New(Options{})
	server.workspace = &hoverWorkspace{summary: &summary}
	server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("initialize"),
		Method:  protocol.MethodInitialize,
		Params:  []byte(`{"capabilities":{"textDocument":{"hover":{"contentFormat":["markdown"]}}}}`),
	})
	result := server.Handle(context.Background(), protocol.Request{
		JSONRPC: protocol.JSONRPCVersion,
		ID:      []byte("1"),
		Method:  protocol.MethodHover,
		Params:  []byte(`{"textDocument":{"uri":"file:///repo/src/a.ts"},"position":{"line":3,"character":5}}`),
	})
	hover, ok := result.Result.(*protocol.Hover)
	if result.Error != nil || !ok {
		t.Fatalf("hover result = %#v, error %#v", result.Result, result.Error)
	}
	if hover.Contents.Value != "**Writer** — prompt\n\n1 incoming · 0 outgoing relations" {
		t.Fatalf("definition hover = %q", hover.Contents.Value)
	}
	if hover.Range == nil || *hover.Range != summary.Definition.Range {
		t.Fatalf("definition hover range = %#v", hover.Range)
	}
}

type hoverWorkspace struct {
	findings []displayedFinding
	summary  *definitionSummary
}

func (w *hoverWorkspace) Start(context.Context, []protocol.WorkspaceFolder, Settings) {}
func (w *hoverWorkspace) UpdateSettings(Settings)                                     {}
func (w *hoverWorkspace) DidOpen(protocol.DocumentURI, int)                           {}
func (w *hoverWorkspace) DidChange(protocol.DocumentURI, int, []protocol.TextDocumentContentChangeEvent) {
}
func (w *hoverWorkspace) DidSave(protocol.DocumentURI)  {}
func (w *hoverWorkspace) DidClose(protocol.DocumentURI) {}
func (w *hoverWorkspace) DisplayedFindings(protocol.DocumentURI, protocol.Position) []displayedFinding {
	return w.findings
}
func (w *hoverWorkspace) DefinitionSummaryAt(protocol.DocumentURI, protocol.Position) (definitionSummary, bool) {
	if w.summary == nil {
		return definitionSummary{}, false
	}
	return *w.summary, true
}
func (w *hoverWorkspace) LeadingWhitespace(protocol.DocumentURI, uint32) (string, bool) {
	return "", true
}
func (w *hoverWorkspace) Close() {}
