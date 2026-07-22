package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherInlayHintsFollowDirtyDefinitionAnchor(t *testing.T) {
	t.Parallel()

	store, publisher, recorder, uri, file := newViewPublisher(t)
	startColumn, endLine, endColumn := 1, 4, 2
	definition := viewDefinition("prompt:writer", file, 3, &startColumn, nil)
	definition.SourceSnippet.Source = "prompt({\n})"
	definition.SourceSnippet.Range.EndLine = &endLine
	definition.SourceSnippet.Range.EndColumn = &endColumn
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
		Findings: []api.IndexLintFinding{{
			ID: "finding", RuleID: "test.finding", Severity: "warning", Title: "Finding",
			Profiles: []string{"recommended"}, PrimaryDefinitionID: definition.ID,
			Source: &api.SourceLoc{File: file, Line: 3},
		}},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 1)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)

	point := protocol.Position{Line: 2, Character: 2}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: point, End: point}, Text: "XX",
	}})
	hints := buildInlayHints(publisher.DefinitionSummariesIn(uri), protocol.Range{
		Start: protocol.Position{Line: 2}, End: protocol.Position{Line: 3},
	})
	if len(hints) != 1 || hints[0].Position != (protocol.Position{Line: 2, Character: 10}) {
		t.Fatalf("dirty hints = %#v, want shifted character 10", hints)
	}
}
