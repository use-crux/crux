package server

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDidChangeTransformsDocumentViewInOrderAndPreservesFullChange(t *testing.T) {
	store, publisher, recorder, uri, file := newViewPublisher(t)
	column := 1
	endColumn := 4
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition("prompt:writer", file, 3, &column, &endColumn)},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", To: "prompt:writer", Source: &api.SourceLoc{File: file, Line: 3, Column: &column},
		}},
		Findings: []api.IndexLintFinding{viewFinding("finding", file, 3)},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 1)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)

	zero := protocol.Position{}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{
		{Range: &protocol.Range{Start: zero, End: zero}, Text: "\n"},
		{Range: &protocol.Range{Start: protocol.Position{Line: 3}, End: protocol.Position{Line: 3}}, Text: "x"},
	})
	view, _ := publisher.openDocumentView(uri)
	if got := view.definitions[0].Range.Start; got != (protocol.Position{Line: 3, Character: 1}) {
		t.Fatalf("ordered definition start = %#v, want line 3 character 1", got)
	}
	if got := view.sites[0].Range.Start; got != (protocol.Position{Line: 3, Character: 1}) {
		t.Fatalf("ordered site start = %#v, want line 3 character 1", got)
	}

	publisher.DidChange(uri, 3, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 3, Character: 2},
			End:   protocol.Position{Line: 3, Character: 3},
		},
		Text: "Q",
	}})
	view, _ = publisher.openDocumentView(uri)
	if got := view.definitions[0].Range; got != (protocol.Range{
		Start: protocol.Position{Line: 3, Character: 3},
		End:   protocol.Position{Line: 3, Character: 3},
	}) {
		t.Fatalf("overlapping definition range = %#v, want collapsed edit end", got)
	}

	before := cloneDocumentView(view)
	publisher.DidChange(uri, 4, []protocol.TextDocumentContentChangeEvent{{Text: "replacement"}})
	after, _ := publisher.openDocumentView(uri)
	assertViewPositionsEqual(t, after, before)
}

func TestPublisherDirtyClearPreservesTransformedNavigationUntilSave(t *testing.T) {
	store, publisher, recorder, uri, file := newViewPublisher(t)
	column := 1
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition("prompt:old", file, 3, &column, nil)},
		Relations: []api.ProjectRelation{{
			ID: "relation:old", To: "prompt:old", Source: &api.SourceLoc{File: file, Line: 3, Column: &column},
		}},
		Findings: []api.IndexLintFinding{viewFinding("old", file, 3)},
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
	publisher.UpdateFilter(mapping.FilterOptions{Profile: "strict"})
	recorder.wait(t, 4)

	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition("prompt:new", file, 8, &column, nil)},
		Relations:   []api.ProjectRelation{{ID: "relation:new", To: "prompt:new", Source: &api.SourceLoc{File: file, Line: 8, Column: &column}}},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.assertCountAfter(t, 4, 20*time.Millisecond)
	cleared := recorder.wait(t, 4)[3]
	if len(cleared.Diagnostics) != 0 {
		t.Fatalf("dirty clear diagnostics = %#v, want empty", cleared.Diagnostics)
	}
	dirty, _ := publisher.openDocumentView(uri)
	if dirty.definitions[0].Definition.ID != "prompt:old" || dirty.definitions[0].Range.Start.Line != 3 {
		t.Fatalf("dirty view = %#v, want transformed old definition", dirty.definitions)
	}

	publisher.DidSave(uri)
	saved, _ := publisher.openDocumentView(uri)
	if saved.definitions[0].Definition.ID != "prompt:new" || saved.definitions[0].Range.Start.Line != 7 {
		t.Fatalf("saved view = %#v, want held disk-truth new definition", saved.definitions)
	}
	if saved.sites[0].Site.ID != "relation:new" {
		t.Fatalf("saved sites = %#v, want held newest site", saved.sites)
	}
}

func TestPublisherCleanAuthoritativeUpdateReplacesViewWithoutDiagnosticDiff(t *testing.T) {
	store, publisher, recorder, uri, file := newViewPublisher(t)
	column := 1
	finding := viewFinding("stable", file, 3)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition("prompt:old", file, 3, &column, nil)},
		Findings:    []api.IndexLintFinding{finding},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 1)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)

	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition("prompt:new", file, 7, &column, nil)},
		Findings:    []api.IndexLintFinding{finding},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.assertCountAfter(t, 2, 20*time.Millisecond)
	view, _ := publisher.openDocumentView(uri)
	if view.definitions[0].Definition.ID != "prompt:new" || view.definitions[0].Range.Start.Line != 6 {
		t.Fatalf("clean authoritative view = %#v, want replacement", view.definitions)
	}
}

func TestPublisherDidSaveResetsNavigationWithoutHeldAuthoritativeView(t *testing.T) {
	store, publisher, recorder, uri, file := newViewPublisher(t)
	column := 1
	definition := viewDefinition("prompt:writer", file, 3, &column, nil)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{definition},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer", To: definition.ID, Source: definition.Source,
		}},
		Findings: []api.IndexLintFinding{viewFinding("stable", file, 3)},
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
		Definitions: []api.ProjectDefinition{definition},
		Relations: []api.ProjectRelation{{
			ID: "relation:writer:new", From: definition.ID, To: "tool:new", Source: definition.Source,
		}},
		Findings: []api.IndexLintFinding{viewFinding("stable", file, 3)},
	})

	publisher.DidSave(uri)
	recorder.assertCountAfter(t, 3, 20*time.Millisecond)
	view, _ := publisher.openDocumentView(uri)
	if view.definitions[0].Range.Start.Line != 2 || view.sites[0].Range.Start.Line != 2 {
		t.Fatalf("saved navigation positions = %#v / %#v, want disk line 2", view.definitions, view.sites)
	}
	if got := view.relationCounts[definition.ID]; got.Incoming != 0 || got.Outgoing != 1 {
		t.Fatalf("saved relation counts = %#v, want current disk truth", got)
	}
}

func TestPublisherDidCloseDiscardsOpenDocumentView(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	column := 1
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition("prompt:writer", file, 3, &column, nil)},
	})
	publisher.DidOpen(uri, 1)
	if _, ok := publisher.openDocumentView(uri); !ok {
		t.Fatal("open view missing before close")
	}
	publisher.DidClose(uri)
	if _, ok := publisher.openDocumentView(uri); ok {
		t.Fatal("open view retained after close")
	}
}

func TestPublisherSerializesConcurrentViewTransformAndReplacement(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	column := 1
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition("prompt:old", file, 3, &column, nil)},
		Relations: []api.ProjectRelation{{
			ID: "relation:old", To: "prompt:old", Source: &api.SourceLoc{File: file, Line: 3, Column: &column},
		}},
	})
	publisher.DidOpen(uri, 1)
	start := make(chan struct{})
	var calls sync.WaitGroup
	calls.Add(2)
	go func() {
		defer calls.Done()
		<-start
		zero := protocol.Position{}
		publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
			Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
		}})
	}()
	go func() {
		defer calls.Done()
		<-start
		store.ApplySnapshot("scope", readmodel.Snapshot{
			Definitions: []api.ProjectDefinition{viewDefinition("prompt:new", file, 8, &column, nil)},
			Relations: []api.ProjectRelation{{
				ID: "relation:new", To: "prompt:new", Source: &api.SourceLoc{File: file, Line: 8, Column: &column},
			}},
		})
		publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	}()
	close(start)
	calls.Wait()
	publisher.DidSave(uri)
	view, ok := publisher.openDocumentView(uri)
	if !ok || len(view.definitions) != 1 || view.definitions[0].Definition.ID != "prompt:new" ||
		len(view.sites) != 1 || view.sites[0].Site.TargetDefinitionID != "prompt:new" {
		t.Fatalf("coherent final view = %#v, %v; want new definition", view, ok)
	}
}

func newViewPublisher(t *testing.T) (*readmodel.Store, *Publisher, *diagnosticRecorder, protocol.DocumentURI, string) {
	return newViewPublisherWithOnPublish(t, nil)
}

func newViewPublisherWithOnPublish(
	t *testing.T,
	onPublish func(),
) (*readmodel.Store, *Publisher, *diagnosticRecorder, protocol.DocumentURI, string) {
	t.Helper()
	root := t.TempDir()
	file := filepath.Join(root, "writer.ts")
	if err := os.WriteFile(file, []byte("😀writer\nuseWriter\nwriter\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := readmodel.NewStore()
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: root, ConfigFile: filepath.Join(root, "crux.config.ts"),
		Store: store, Lines: mapping.NewLineIndex(), Notify: recorder.notify, OnPublish: onPublish,
	})
	t.Cleanup(publisher.Close)
	return store, publisher, recorder, protocol.DocumentURI(mapping.FileURI(root, file)), file
}

func viewDefinition(id, file string, line int, startColumn, endColumn *int) api.ProjectDefinition {
	endLine := line
	return api.ProjectDefinition{
		ID: id, Kind: "prompt", Name: id, Fidelity: "resolved",
		Source: &api.SourceLoc{File: file, Line: line, Column: startColumn},
		SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
			File: file, StartLine: line, EndLine: &endLine, StartColumn: startColumn, EndColumn: endColumn,
		}},
	}
}

func viewFinding(id, file string, line int) api.IndexLintFinding {
	return api.IndexLintFinding{
		ID: id, RuleID: "test." + id, Severity: "warning", Title: id,
		Profiles: []string{"recommended"}, Source: &api.SourceLoc{File: file, Line: line},
	}
}

func assertViewPositionsEqual(t *testing.T, got, want documentView) {
	t.Helper()
	if got.definitions[0].Range != want.definitions[0].Range || got.sites[0].Range != want.sites[0].Range {
		t.Fatalf("view positions = %#v / %#v, want %#v / %#v", got.definitions, got.sites, want.definitions, want.sites)
	}
}
