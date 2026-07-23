package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDerivesDefinitionFirstLineEndFromSnippetUTF16(t *testing.T) {
	t.Parallel()

	store, publisher, _, uri, file := newViewPublisher(t)
	startColumn, endLine, endColumn := 5, 2, 2
	withSnippet := viewDefinition("prompt:snippet", file, 1, &startColumn, nil)
	withSnippet.SourceSnippet.Source = "prompt(😀{\r\n})"
	withSnippet.SourceSnippet.Range.EndLine = &endLine
	withSnippet.SourceSnippet.Range.EndColumn = &endColumn
	fallback := viewDefinition("prompt:fallback", file, 3, nil, nil)
	fallback.SourceSnippet.Source = ""
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{withSnippet, fallback},
	})

	publisher.DidOpen(uri, 1)
	view, ok := publisher.openDocumentView(uri)
	if !ok || len(view.definitions) != 2 {
		t.Fatalf("definition view = %#v, %v", view.definitions, ok)
	}
	if got, want := view.definitions[0].FirstLineEnd, (protocol.Position{Line: 0, Character: 12}); got != want {
		t.Fatalf("snippet first-line end = %#v, want %#v", got, want)
	}
	if got, want := view.definitions[1].FirstLineEnd, view.definitions[1].Range.Start; got != want {
		t.Fatalf("fallback first-line end = %#v, want range start %#v", got, want)
	}
}

func TestPublisherTransformsDefinitionFirstLineEndThroughDirtyEdits(t *testing.T) {
	t.Parallel()

	store, publisher, _, uri, file := newViewPublisher(t)
	startColumn, endLine, endColumn := 1, 4, 2
	definition := viewDefinition("prompt:writer", file, 3, &startColumn, nil)
	definition.SourceSnippet.Source = "prompt({\n})"
	definition.SourceSnippet.Range.EndLine = &endLine
	definition.SourceSnippet.Range.EndColumn = &endColumn
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{definition}})
	publisher.DidOpen(uri, 1)

	point := protocol.Position{Line: 2, Character: 2}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: point, End: point}, Text: "XX",
	}})
	view, _ := publisher.openDocumentView(uri)
	if got, want := view.definitions[0].FirstLineEnd, (protocol.Position{Line: 2, Character: 10}); got != want {
		t.Fatalf("dirty first-line end = %#v, want %#v", got, want)
	}
	if got, want := view.definitions[0].Range, (protocol.Range{
		Start: protocol.Position{Line: 2, Character: 4},
		End:   protocol.Position{Line: 2, Character: 4},
	}); got != want {
		t.Fatalf("overlapped definition range = %#v, want %#v", got, want)
	}

	zero := protocol.Position{}
	publisher.DidChange(uri, 3, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	view, _ = publisher.openDocumentView(uri)
	if got, want := view.definitions[0].FirstLineEnd, (protocol.Position{Line: 3, Character: 10}); got != want {
		t.Fatalf("shifted first-line end = %#v, want %#v", got, want)
	}
}
