package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestWorkspaceDocumentSymbolsMapMultilineRangeAndFallbackName(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	file := navigationTestFile(t, root, "writer.ts", "first\nwriter\nbody\nend\n")
	startColumn, endColumn, endLine := 1, 2, 4
	definition := api.ProjectDefinition{
		ID: "agent:writer", Kind: "agent",
		Source: &api.SourceLoc{File: file, Line: 2, Column: &startColumn},
		SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
			File: file, StartLine: 2, EndLine: &endLine,
			StartColumn: &startColumn, EndColumn: &endColumn,
		}},
	}
	publisher := navigationTestPublisher(t, "scope", root, readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
	})
	workspace := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: "scope", Root: root}, publisher: publisher,
	}}}
	uri := protocol.DocumentURI(mapping.FileURI(root, file))

	symbols := workspace.DocumentSymbols(uri)
	if len(symbols) != 1 {
		t.Fatalf("document symbols = %#v, want one", symbols)
	}
	wantRange := protocol.Range{
		Start: protocol.Position{Line: 1},
		End:   protocol.Position{Line: 3, Character: 1},
	}
	wantSelection := protocol.Range{Start: wantRange.Start, End: wantRange.Start}
	if got := symbols[0]; got.Name != definition.ID || got.Detail != "agent" ||
		got.Kind != protocol.SymbolKindClass || got.Range != wantRange ||
		got.SelectionRange != wantSelection {
		t.Fatalf("document symbol = %#v, want ID fallback, multiline range, and start anchor", got)
	}
	if !rangeContainsRange(symbols[0].Range, symbols[0].SelectionRange) {
		t.Fatalf("selection range %#v is not contained by %#v", symbols[0].SelectionRange, symbols[0].Range)
	}
}

func TestWorkspaceDocumentSymbolsUseMostSpecificContainingScope(t *testing.T) {
	t.Parallel()

	parent := t.TempDir()
	child := filepath.Join(parent, "child")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatal(err)
	}
	file := navigationTestFile(t, child, "writer.ts", "writer\n")
	column := 1
	parentPublisher := navigationTestPublisher(t, "parent", parent, readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{
			navigationTestDefinition("prompt:parent", file, 1, &column, nil),
		},
	})
	childPublisher := navigationTestPublisher(t, "child", child, readmodel.Snapshot{})
	workspace := &workspaceRuntime{sessions: []*scopeSession{
		{scope: readmodel.Scope{ID: "parent", Root: parent}, publisher: parentPublisher},
		{scope: readmodel.Scope{ID: "child", Root: child}, publisher: childPublisher},
	}}

	symbols := workspace.DocumentSymbols(protocol.DocumentURI(mapping.FileURI(child, file)))
	if symbols == nil || len(symbols) != 0 {
		t.Fatalf("nested document symbols = %#v, want [] from empty child scope", symbols)
	}
}

func TestWorkspaceDocumentSymbolSelectionRemainsValidWhenDirtyRangeCollapses(t *testing.T) {
	t.Parallel()

	store, publisher, _, uri, file := newViewPublisher(t)
	startColumn, endColumn := 2, 5
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{
		viewDefinition("prompt:writer", file, 3, &startColumn, &endColumn),
	}})
	publisher.DidOpen(uri, 1)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 2},
			End:   protocol.Position{Line: 2, Character: 5},
		},
	}})
	workspace := &workspaceRuntime{sessions: []*scopeSession{{
		scope: readmodel.Scope{ID: "scope", Root: filepath.Dir(file)}, publisher: publisher,
	}}}

	symbols := workspace.DocumentSymbols(uri)
	if len(symbols) != 1 {
		t.Fatalf("dirty document symbols = %#v, want one", symbols)
	}
	marker := protocol.Range{Start: protocol.Position{Line: 2}, End: protocol.Position{Line: 2}}
	if symbols[0].Range != marker || symbols[0].SelectionRange != marker {
		t.Fatalf("collapsed symbol ranges = %#v / %#v, want %#v", symbols[0].Range, symbols[0].SelectionRange, marker)
	}
	if !rangeContainsRange(symbols[0].Range, symbols[0].SelectionRange) {
		t.Fatalf("collapsed selection range %#v is not contained by %#v", symbols[0].SelectionRange, symbols[0].Range)
	}
}

func rangeContainsRange(outer, inner protocol.Range) bool {
	return !positionBefore(inner.Start, outer.Start) && !positionBefore(outer.End, inner.End)
}

func positionBefore(left, right protocol.Position) bool {
	return left.Line < right.Line || left.Line == right.Line && left.Character < right.Character
}
