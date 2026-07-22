package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDidOpenMapsDefinitionsAndSitesToUTF16(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	startColumn, endColumn := 5, 10
	definition := viewDefinition("prompt:writer", file, 1, &startColumn, &endColumn)
	fallbackColumn := 4
	fallback := viewDefinition("prompt:fallback", file, 3, &fallbackColumn, nil)
	fallback.SourceSnippet.Range.StartLine = 0
	wholeLineSite := api.SourceLoc{File: file, Line: 2}
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition, fallback},
		Relations: []api.ProjectRelation{
			{ID: "relation:column", To: definition.ID, Source: definition.Source},
			{ID: "relation:line", To: definition.ID, Source: &wholeLineSite},
		},
	})

	publisher.DidOpen(uri, 1)
	view, ok := publisher.openDocumentView(uri)
	if !ok {
		t.Fatal("open document view missing")
	}
	if got := view.definitions[0].Range; got.Start.Character != 2 || got.End.Character != 7 {
		t.Fatalf("definition UTF-16 range = %#v, want characters 2..7", got)
	}
	if got := view.definitions[1].Range; got != (protocol.Range{Start: protocol.Position{Line: 2}, End: protocol.Position{Line: 3}}) {
		t.Fatalf("source fallback range = %#v, want whole third line", got)
	}
	if got := view.sites[0].Range; got.Start.Character != 2 || got.Start != got.End {
		t.Fatalf("column site range = %#v, want zero-width character 2", got)
	}
	if got := view.sites[1].Range; got != (protocol.Range{Start: protocol.Position{Line: 1}, End: protocol.Position{Line: 2}}) {
		t.Fatalf("columnless site range = %#v, want whole second line", got)
	}
}

func TestPublisherOpenDocumentViewReturnsDetachedNestedValues(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	column := 1
	definition := viewDefinition("prompt:writer", file, 3, &column, nil)
	definition.Tags = []string{"stable"}
	definition.SourceRefs = []api.ProjectSourceRef{{
		ID: "ref:writer", Source: api.SourceLoc{File: file, Line: 2, Column: &column},
		Metadata: map[string]any{
			"roles": []any{"input"}, "labels": []string{"stable"}, "payload": []byte("stable"),
		},
	}}
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{definition}})
	publisher.DidOpen(uri, 1)

	first, _ := publisher.openDocumentView(uri)
	first.definitions[0].Definition.Tags[0] = "mutated"
	*first.definitions[0].Definition.Source.Column = 99
	first.definitions[0].Definition.SourceRefs[0].Metadata["roles"].([]any)[0] = "mutated"
	first.definitions[0].Definition.SourceRefs[0].Metadata["labels"].([]string)[0] = "mutated"
	first.definitions[0].Definition.SourceRefs[0].Metadata["payload"].([]byte)[0] = 'X'
	*first.sites[0].Site.Source.Column = 99
	second, _ := publisher.openDocumentView(uri)
	if second.definitions[0].Definition.Tags[0] != "stable" ||
		*second.definitions[0].Definition.Source.Column != 1 ||
		second.definitions[0].Definition.SourceRefs[0].Metadata["roles"].([]any)[0] != "input" ||
		second.definitions[0].Definition.SourceRefs[0].Metadata["labels"].([]string)[0] != "stable" ||
		string(second.definitions[0].Definition.SourceRefs[0].Metadata["payload"].([]byte)) != "stable" ||
		*second.sites[0].Site.Source.Column != 1 {
		t.Fatalf("second view shares nested state: %#v", second)
	}
}
