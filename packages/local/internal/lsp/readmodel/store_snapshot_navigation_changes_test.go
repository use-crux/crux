package readmodel

import (
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestStoreSnapshotReportsDefinitionAndNavigationSiteFiles(t *testing.T) {
	store := NewStore()
	store.ApplySnapshot("scope", Snapshot{Definitions: []api.ProjectDefinition{
		snapshotDefinition("prompt:writer", "old.ts", 2, "ref:writer", "old-ref.ts", 3),
	}})

	changed := store.ApplySnapshot("scope", Snapshot{Definitions: []api.ProjectDefinition{
		snapshotDefinition("prompt:writer", "new.ts", 4, "ref:writer", "new-ref.ts", 5),
	}})
	assertStrings(t, changed, []string{"new-ref.ts", "new.ts", "old-ref.ts", "old.ts"})

	unchanged := store.ApplySnapshot("scope", Snapshot{Definitions: []api.ProjectDefinition{
		snapshotDefinition("prompt:writer", "new.ts", 4, "ref:writer", "new-ref.ts", 5),
	}})
	assertStrings(t, unchanged, []string{})
}

func TestManagerForwardsDefinitionAndSourceRefOnlySnapshots(t *testing.T) {
	store := NewStore()
	var changes []Change
	manager := NewManager(ManagerOptions{
		ScopeID: "scope",
		Store:   store,
		OnChange: func(change Change) {
			changes = append(changes, change)
		},
	})
	manager.applySnapshot(Snapshot{Definitions: []api.ProjectDefinition{
		snapshotDefinition("prompt:writer", "writer.ts", 2, "ref:writer", "input.ts", 3),
	}})
	changes = nil

	manager.applySnapshot(Snapshot{Definitions: []api.ProjectDefinition{
		snapshotDefinition("prompt:writer", "writer.ts", 4, "ref:writer", "input.ts", 3),
	}})
	manager.applySnapshot(Snapshot{Definitions: []api.ProjectDefinition{
		snapshotDefinition("prompt:writer", "writer.ts", 4, "ref:writer", "other.ts", 5),
	}})

	if len(changes) != 2 {
		t.Fatalf("publisher callback changes = %#v, want definition and source-ref snapshots", changes)
	}
	if !changes[0].Immediate || !reflect.DeepEqual(changes[0].Files, []string{"writer.ts"}) {
		t.Fatalf("definition-only change = %#v", changes[0])
	}
	if !changes[1].Immediate || !reflect.DeepEqual(changes[1].Files, []string{"input.ts", "other.ts", "writer.ts"}) {
		t.Fatalf("source-ref-only change = %#v", changes[1])
	}
}

func snapshotDefinition(id, file string, line int, refID, refFile string, refLine int) api.ProjectDefinition {
	return api.ProjectDefinition{
		ID: id,
		SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
			File: file, StartLine: line,
		}},
		SourceRefs: []api.ProjectSourceRef{{
			ID: refID, Source: api.SourceLoc{File: refFile, Line: refLine},
		}},
	}
}
