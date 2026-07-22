package server

import (
	"fmt"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherQueriesAreSafeDuringChangesAndAuthoritativePublishes(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	column := 1
	store.ApplySnapshot("scope", querySnapshot("prompt:initial", "relation:initial", file, 3, &column))
	publisher.DidOpen(uri, 1)

	start := make(chan struct{})
	var workers sync.WaitGroup
	workers.Add(3)
	go func() {
		defer workers.Done()
		<-start
		for version := 2; version < 80; version++ {
			position := protocol.Position{Line: 2}
			publisher.DidChange(uri, version, []protocol.TextDocumentContentChangeEvent{{
				Range: &protocol.Range{Start: position, End: position}, Text: "x",
			}})
		}
	}()
	go func() {
		defer workers.Done()
		<-start
		for index := 0; index < 80; index++ {
			id := fmt.Sprintf("prompt:%03d", index)
			store.ApplySnapshot("scope", querySnapshot(id, fmt.Sprintf("relation:%03d", index), file, 3, &column))
			publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
		}
	}()
	go func() {
		defer workers.Done()
		<-start
		for index := 0; index < 160; index++ {
			publisher.SiteAt(uri, protocol.Position{Line: 2, Character: uint32(index % 10)})
			publisher.DefinitionAt(uri, protocol.Position{Line: 2, Character: uint32(index % 10)})
			publisher.DefinitionsIn(uri)
			publisher.ReferencesTo(fmt.Sprintf("prompt:%03d", index%80))
			publisher.AllDefinitions("prompt")
		}
	}()
	close(start)
	workers.Wait()

	final := querySnapshot("prompt:final", "relation:final", file, 3, &column)
	store.ApplySnapshot("scope", final)
	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	publisher.DidSave(uri)
	definitions := publisher.AllDefinitions("")
	references := publisher.ReferencesTo("prompt:final")
	if len(definitions) != 1 || definitions[0].Definition.ID != "prompt:final" ||
		len(references) != 1 || references[0].Site.ID != "relation:final" {
		t.Fatalf("final coherent query view = definitions %#v, references %#v", definitions, references)
	}
}

func querySnapshot(definitionID, relationID, file string, line int, column *int) readmodel.Snapshot {
	return readmodel.Snapshot{
		Definitions: []api.ProjectDefinition{viewDefinition(definitionID, file, line, column, nil)},
		Relations: []api.ProjectRelation{{
			ID: relationID, To: definitionID, Source: &api.SourceLoc{File: file, Line: line, Column: column},
		}},
	}
}
