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

func TestSummarizeDefinitionsCountsUniqueDisplayedFindingsAndRelations(t *testing.T) {
	t.Parallel()

	definition := documentDefinition{
		Definition: api.ProjectDefinition{ID: "prompt:writer", Name: "Writer", Kind: "prompt"},
		Range: protocol.Range{
			Start: protocol.Position{Line: 2, Character: 4},
			End:   protocol.Position{Line: 4, Character: 2},
		},
	}
	view := documentView{
		definitions: []documentDefinition{definition},
		findings: map[string]api.IndexLintFinding{
			"primary":  {ID: "primary", PrimaryDefinitionID: "prompt:writer"},
			"affected": {ID: "affected", AffectedDefinitionIDs: []string{"prompt:writer"}},
			"anchored": {ID: "anchored"},
			"outside":  {ID: "outside", RelatedDefinitionIDs: []string{"prompt:writer"}},
		},
		diagnostics: []protocol.Diagnostic{
			summaryDiagnostic("primary", 8, 0),
			summaryDiagnostic("affected", 9, 0),
			summaryDiagnostic("anchored", 3, 1),
			summaryDiagnostic("anchored", 3, 2),
			summaryDiagnostic("outside", 4, 2),
		},
	}
	relations := []api.ProjectRelation{
		{ID: "incoming", From: "agent:writer", To: "prompt:writer"},
		{ID: "outgoing-1", From: "prompt:writer", To: "tool:first"},
		{ID: "outgoing-2", From: "prompt:writer", To: "tool:second"},
		{ID: "unrelated", From: "agent:other", To: "tool:other"},
	}

	view.relationCounts = countDefinitionRelations(view.definitions, relations)
	summaries := summarizeDefinitions(view, view.findings, view.relationCounts)
	if len(summaries) != 1 {
		t.Fatalf("summaries = %#v", summaries)
	}
	got := summaries[0]
	if got.FindingCount != 3 || got.IncomingRelations != 1 || got.OutgoingRelations != 2 {
		t.Fatalf("summary counts = %#v, want findings=3 incoming=1 outgoing=2", got)
	}
}

func TestPublisherDefinitionSummaryCountsCrossFileDisplayedIDLink(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	definitionFile := filepath.Join(root, "definition.ts")
	findingFile := filepath.Join(root, "finding.ts")
	for _, file := range []string{definitionFile, findingFile} {
		if err := os.WriteFile(file, []byte("prompt({\n})\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	column, endLine, endColumn := 1, 2, 2
	definition := api.ProjectDefinition{
		ID: "prompt:writer", Name: "Writer", Kind: "prompt",
		Source: &api.SourceLoc{File: definitionFile, Line: 1, Column: &column},
		SourceSnippet: &api.SourceSnippet{Source: "prompt({\n})", Range: api.SourceRange{
			File: definitionFile, StartLine: 1, EndLine: &endLine,
			StartColumn: &column, EndColumn: &endColumn,
		}},
	}
	store := readmodel.NewStore()
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
		Findings: []api.IndexLintFinding{{
			ID: "cross-file", RuleID: "test.cross_file", Severity: "warning", Title: "Cross-file",
			Profiles: []string{"recommended"}, PrimaryDefinitionID: definition.ID,
			Source: &api.SourceLoc{File: findingFile, Line: 1},
		}},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: root, Store: store, Notify: recorder.notify,
	})
	t.Cleanup(publisher.Close)
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 1)
	uri := protocol.DocumentURI(mapping.FileURI(root, definitionFile))
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)

	summary, ok := publisher.DefinitionSummaryAt(uri, protocol.Position{Line: 0, Character: 2})
	if !ok || summary.FindingCount != 1 {
		t.Fatalf("cross-file summary = %#v, %v; want one displayed linked finding", summary, ok)
	}
}

func TestPublisherDefinitionSummaryHoldsRelationCountsWhileDirty(t *testing.T) {
	t.Parallel()

	store, publisher, recorder, uri, file := newViewPublisher(t)
	column := 1
	definition := viewDefinition("prompt:writer", file, 3, &column, nil)
	definition.SourceSnippet.Source = "prompt({\n})"
	finding := viewFinding("finding", file, 3)
	finding.PrimaryDefinitionID = definition.ID
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition}, Findings: []api.IndexLintFinding{finding},
		Relations: []api.ProjectRelation{{ID: "old-incoming", From: "agent:writer", To: definition.ID}},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 1)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	zero := protocol.Position{}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	recorder.wait(t, 3)

	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition}, Findings: []api.IndexLintFinding{finding},
		Relations: []api.ProjectRelation{
			{ID: "new-outgoing-1", From: definition.ID, To: "tool:first"},
			{ID: "new-outgoing-2", From: definition.ID, To: "tool:second"},
		},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	dirty := publisher.DefinitionSummariesIn(uri)[0]
	if dirty.IncomingRelations != 1 || dirty.OutgoingRelations != 0 {
		t.Fatalf("dirty relation counts = %#v, want held old counts", dirty)
	}

	publisher.DidSave(uri)
	saved := publisher.DefinitionSummariesIn(uri)[0]
	if saved.IncomingRelations != 0 || saved.OutgoingRelations != 2 {
		t.Fatalf("saved relation counts = %#v, want newest held counts", saved)
	}
}

func TestWorkspaceHoverUsesMostSpecificPublisher(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	nested := filepath.Join(root, "nested")
	if err := os.Mkdir(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(nested, "writer.ts")
	if err := os.WriteFile(file, []byte("writer\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	column, endColumn := 1, 7
	store := readmodel.NewStore()
	store.ApplySnapshot("outer", readmodel.Snapshot{Definitions: []api.ProjectDefinition{
		viewDefinition("prompt:outer", file, 1, &column, &endColumn),
	}})
	store.ApplySnapshot("nested", readmodel.Snapshot{Definitions: []api.ProjectDefinition{
		viewDefinition("prompt:nested", file, 1, &column, &endColumn),
	}})
	newPublisher := func(scope, scopeRoot string) *Publisher {
		publisher := NewPublisher(PublisherOptions{ScopeID: scope, Root: scopeRoot, Store: store})
		t.Cleanup(publisher.Close)
		return publisher
	}
	workspace := &workspaceRuntime{sessions: []*scopeSession{
		{scope: readmodel.Scope{ID: "outer", Root: root}, publisher: newPublisher("outer", root)},
		{scope: readmodel.Scope{ID: "nested", Root: nested}, publisher: newPublisher("nested", nested)},
	}}
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	_, summary := workspace.HoverAt(uri, protocol.Position{})
	if summary == nil || summary.Definition.Definition.ID != "prompt:nested" {
		t.Fatalf("hover summary = %#v, want nested scope definition", summary)
	}
}

func summaryDiagnostic(id string, line, character uint32) protocol.Diagnostic {
	return protocol.Diagnostic{
		Range: protocol.Range{
			Start: protocol.Position{Line: line, Character: character},
			End:   protocol.Position{Line: line, Character: character + 1},
		},
		Data: []byte(`{"id":"` + id + `"}`),
	}
}
