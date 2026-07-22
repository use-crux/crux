package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDefinitionAtUsesDisplayedRangeContainmentAndSourceLineFallback(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	start, end := 5, 10
	snippet := viewDefinition("prompt:snippet", file, 1, &start, &end)
	fallbackColumn := 4
	fallback := viewDefinition("prompt:fallback", file, 3, &fallbackColumn, nil)
	fallback.SourceSnippet.Range.StartLine = 0
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{snippet, fallback}})
	publisher.DidOpen(uri, 1)

	matched, ok := publisher.DefinitionAt(uri, protocol.Position{Line: 0, Character: 2})
	if !ok || matched.Definition.ID != "prompt:snippet" ||
		matched.Range != (protocol.Range{
			Start: protocol.Position{Line: 0, Character: 2},
			End:   protocol.Position{Line: 0, Character: 7},
		}) {
		t.Fatalf("snippet DefinitionAt = %#v, %v", matched, ok)
	}
	if _, ok := publisher.DefinitionAt(uri, protocol.Position{Line: 0, Character: 7}); ok {
		t.Fatal("DefinitionAt included a non-zero range's exclusive end")
	}
	line, ok := publisher.DefinitionAt(uri, protocol.Position{Line: 2, Character: 100})
	if !ok || line.Definition.ID != "prompt:fallback" {
		t.Fatalf("source-line DefinitionAt = %#v, %v", line, ok)
	}
}

func TestPublisherAllDefinitionsFiltersNameAndIDSortsAndDetaches(t *testing.T) {
	store, publisher, _, _, writerFile := newViewPublisher(t)
	root := filepath.Dir(writerFile)
	aFile, zFile := filepath.Join(root, "a.ts"), filepath.Join(root, "z.ts")
	if err := os.WriteFile(aFile, []byte("alpha\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(zFile, []byte("beta\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	column := 1
	alpha := viewDefinition("prompt:alpha", aFile, 1, &column, nil)
	alpha.Name, alpha.Tags = "Writer Alpha", []string{"stable"}
	beta := viewDefinition("prompt:beta", zFile, 1, &column, nil)
	beta.Name = "Other"
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{beta, alpha}})

	all := publisher.AllDefinitions("")
	if len(all) != 2 || all[0].Definition.ID != alpha.ID || all[1].Definition.ID != beta.ID {
		t.Fatalf("AllDefinitions empty query = %#v, want deterministic file order", all)
	}
	byName := publisher.AllDefinitions("WRITER")
	if len(byName) != 1 || byName[0].Definition.ID != alpha.ID {
		t.Fatalf("AllDefinitions name filter = %#v", byName)
	}
	byID := publisher.AllDefinitions("PROMPT:BETA")
	if len(byID) != 1 || byID[0].Definition.ID != beta.ID {
		t.Fatalf("AllDefinitions ID filter = %#v", byID)
	}
	all[0].Definition.Tags[0] = "mutated"
	*all[0].Definition.Source.Column = 99
	again := publisher.AllDefinitions("alpha")
	if again[0].Definition.Tags[0] != "stable" || *again[0].Definition.Source.Column != 1 {
		t.Fatalf("AllDefinitions result aliases publisher or Store state: %#v", again)
	}
}

func TestPublisherAllDefinitionsSubstitutesDirtyDisplayedDefinitions(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	closedFile := filepath.Join(filepath.Dir(file), "closed-definition.ts")
	if err := os.WriteFile(closedFile, []byte("closed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	column := 1
	old := viewDefinition("prompt:old", file, 3, &column, nil)
	closed := viewDefinition("prompt:closed", closedFile, 1, &column, nil)
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{old, closed}})
	publisher.DidOpen(uri, 1)
	zero := protocol.Position{}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	newDefinition := viewDefinition("prompt:new", file, 1, &column, nil)
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{newDefinition, closed}})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})

	dirty := publisher.AllDefinitions("")
	displayedOld, ok := queryDefinitionByID(dirty, old.ID)
	if !ok || displayedOld.Range.Start.Line != 3 {
		t.Fatalf("dirty AllDefinitions = %#v, want shifted old definition", dirty)
	}
	if _, ok := queryDefinitionByID(dirty, newDefinition.ID); ok {
		t.Fatalf("dirty AllDefinitions leaked held Store definition: %#v", dirty)
	}
	if _, ok := queryDefinitionByID(dirty, closed.ID); !ok {
		t.Fatalf("dirty AllDefinitions dropped closed-file definition: %#v", dirty)
	}

	publisher.DidSave(uri)
	saved := publisher.AllDefinitions("")
	if _, ok := queryDefinitionByID(saved, newDefinition.ID); !ok {
		t.Fatalf("saved AllDefinitions = %#v, want held definition", saved)
	}
}

func TestPublisherDefinitionLookupUsesDisplayedDefinitionInsteadOfHeldStoreValue(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	column := 1
	old := viewDefinition("prompt:old", file, 3, &column, nil)
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{old}})
	publisher.DidOpen(uri, 1)
	zero := protocol.Position{}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	newDefinition := viewDefinition("prompt:new", file, 1, &column, nil)
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{newDefinition}})
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})

	displayed, ok := publisher.Definition(old.ID)
	if !ok || displayed.Range.Start.Line != 3 {
		t.Fatalf("Definition(old) = %#v, %v; want shifted displayed definition", displayed, ok)
	}
	if _, ok := publisher.Definition(newDefinition.ID); ok {
		t.Fatal("Definition(new) exposed a held Store definition in an open URI")
	}
	publisher.DidSave(uri)
	if _, ok := publisher.Definition(old.ID); ok {
		t.Fatal("Definition(old) survived applying held authoritative view")
	}
	if current, ok := publisher.Definition(newDefinition.ID); !ok || current.Range.Start.Line != 0 {
		t.Fatalf("Definition(new) after save = %#v, %v", current, ok)
	}
}

func queryDefinitionByID(definitions []documentDefinition, id string) (documentDefinition, bool) {
	for _, definition := range definitions {
		if definition.Definition.ID == id {
			return definition, true
		}
	}
	return documentDefinition{}, false
}

func TestPublisherDefinitionAtMatchesCollapsedMarkerAndClosedStoreRange(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	start, end := 2, 5
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{
		viewDefinition("prompt:writer", file, 3, &start, &end),
	}})
	publisher.DidOpen(uri, 1)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 2},
			End:   protocol.Position{Line: 2, Character: 5},
		},
	}})
	marker, ok := publisher.DefinitionAt(uri, protocol.Position{Line: 2})
	if !ok || marker.Range.Start != marker.Range.End {
		t.Fatalf("collapsed DefinitionAt = %#v, %v", marker, ok)
	}
	if _, ok := publisher.DefinitionAt(uri, protocol.Position{Line: 2, Character: 1}); ok {
		t.Fatal("collapsed DefinitionAt matched away from its marker")
	}

	publisher.DidClose(uri)
	disk, ok := publisher.DefinitionAt(uri, protocol.Position{Line: 2, Character: 1})
	if !ok || disk.Definition.ID != "prompt:writer" || disk.Range.Start.Character != 1 {
		t.Fatalf("closed DefinitionAt = %#v, %v", disk, ok)
	}
}

func TestPublisherDefinitionsInFollowsOpenTransformThenSaveAndClose(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	column := 1
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{
		viewDefinition("prompt:writer", file, 3, &column, nil),
	}})
	publisher.DidOpen(uri, 1)
	zero := protocol.Position{}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: zero, End: zero}, Text: "\n",
	}})
	shifted := publisher.DefinitionsIn(uri)
	if len(shifted) != 1 || shifted[0].Range.Start.Line != 3 {
		t.Fatalf("dirty DefinitionsIn = %#v, want shifted line 3", shifted)
	}

	publisher.DidSave(uri)
	saved := publisher.DefinitionsIn(uri)
	if len(saved) != 1 || saved[0].Range.Start.Line != 2 {
		t.Fatalf("saved DefinitionsIn = %#v, want Store line 2", saved)
	}
	publisher.DidClose(uri)
	closed := publisher.DefinitionsIn(uri)
	if len(closed) != 1 || closed[0].Range.Start.Line != 2 {
		t.Fatalf("closed DefinitionsIn = %#v, want Store line 2", closed)
	}
}

func TestPublisherDefinitionsInSortsCollapsedDirtyRangesWithoutMutatingView(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	start, end := 1, 5
	earlier := viewDefinition("prompt:z", file, 1, &start, &end)
	later := viewDefinition("prompt:a", file, 3, &start, &end)
	earlier.Tags, later.Tags = []string{"earlier"}, []string{"later"}
	store.ApplySnapshot("scope", readmodel.Snapshot{Definitions: []api.ProjectDefinition{earlier, later}})
	publisher.DidOpen(uri, 1)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{},
			End:   protocol.Position{Line: 2, Character: 5},
		},
	}})

	definitions := publisher.DefinitionsIn(uri)
	if len(definitions) != 2 || definitions[0].Definition.ID != "prompt:a" ||
		definitions[1].Definition.ID != "prompt:z" || definitions[0].Range != definitions[1].Range {
		t.Fatalf("collapsed DefinitionsIn = %#v, want ID tie-break a then z", definitions)
	}
	definitions[0].Definition.Tags[0] = "mutated"
	view, _ := publisher.openDocumentView(uri)
	if view.definitions[0].Definition.ID != "prompt:z" || view.definitions[0].Definition.Tags[0] != "earlier" ||
		view.definitions[1].Definition.ID != "prompt:a" || view.definitions[1].Definition.Tags[0] != "later" {
		t.Fatalf("DefinitionsIn reordered or aliased the open view: %#v", view.definitions)
	}
	again := publisher.DefinitionsIn(uri)
	if again[0].Definition.ID != "prompt:a" || again[0].Definition.Tags[0] != "later" {
		t.Fatalf("second DefinitionsIn = %#v, want detached stable result", again)
	}
}
