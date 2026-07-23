package readmodel

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestStoreRetainsDetachedSortedRelationLookups(t *testing.T) {
	store := NewStore()
	generation := uint64(1)
	columnOne, columnThree := 1, 3
	inputBSource := &api.SourceLoc{File: "b.ts", Line: 3, Column: &columnOne}
	relations := []api.ProjectRelation{
		{ID: "relation:b", To: "tool:search", Source: inputBSource},
		{ID: "relation:a1-b", To: "tool:search", Source: &api.SourceLoc{File: "a.ts", Line: 1, Column: &columnOne}},
		{ID: "relation:a3", To: "tool:search", Source: &api.SourceLoc{File: "a.ts", Line: 1, Column: &columnThree}},
		{ID: "relation:unresolved", To: "tool:search", Metadata: json.RawMessage(`{"reason":"missing source"}`)},
		{ID: "relation:other", To: "tool:other", Source: &api.SourceLoc{File: "c.ts", Line: 1}},
		{ID: "relation:a-line2", To: "tool:search", Source: &api.SourceLoc{File: "a.ts", Line: 2}},
		{ID: "relation:a1-a", To: "tool:search", Source: &api.SourceLoc{File: "a.ts", Line: 1, Column: &columnOne}},
	}

	changed := store.ApplySnapshot("scope", Snapshot{Generation: &generation, Relations: relations})
	assertStrings(t, changed, []string{"a.ts", "b.ts", "c.ts"})

	inputBSource.File = "mutated.ts"
	columnOne = 99
	relations[3].Metadata[0] = '['
	assertRelationIDs(t, store.Relations("scope"), []string{
		"relation:unresolved", "relation:a1-a", "relation:a1-b", "relation:a3",
		"relation:a-line2", "relation:b", "relation:other",
	})
	assertRelationIDs(t, store.RelationsTo("scope", "tool:search"), []string{
		"relation:unresolved", "relation:a1-a", "relation:a1-b", "relation:a3", "relation:a-line2", "relation:b",
	})
	assertRelationIDs(t, store.RelationsInFile("scope", "a.ts"), []string{
		"relation:a1-a", "relation:a1-b", "relation:a3", "relation:a-line2",
	})
	if got := store.RelationsInFile("scope", ""); len(got) != 0 {
		t.Fatalf("source-less relation appeared in file lookup: %#v", got)
	}
	storedB := relationByID(t, store.Relations("scope"), "relation:b")
	if storedB.Source == nil || storedB.Source.File != "b.ts" || storedB.Source.Column == nil || *storedB.Source.Column != 1 {
		t.Fatalf("stored relation aliases input source or column: %#v", storedB.Source)
	}

	detached := store.RelationsTo("scope", "tool:search")
	detached[0].Metadata[0] = '['
	returnedA := relationByID(t, detached, "relation:a1-a")
	returnedA.Source.File = "mutated.ts"
	*returnedA.Source.Column = 77
	again := store.RelationsTo("scope", "tool:search")
	againA := relationByID(t, again, "relation:a1-a")
	if string(again[0].Metadata) != `{"reason":"missing source"}` || againA.Source.File != "a.ts" ||
		againA.Source.Column == nil || *againA.Source.Column != 1 {
		t.Fatalf("stored relations changed through returned copies: %#v", again)
	}

	result := store.ApplyDelta("scope", Delta{Generation: 2, File: "a.ts"})
	if result.Status != DeltaApplied {
		t.Fatalf("relation-omitting delta status = %v, want applied", result.Status)
	}
	assertRelationIDs(t, store.Relations("scope"), []string{
		"relation:unresolved", "relation:a1-a", "relation:a1-b", "relation:a3",
		"relation:a-line2", "relation:b", "relation:other",
	})

	replacement := Snapshot{Generation: &generation, Relations: []api.ProjectRelation{{
		ID: "relation:replacement", Type: "uses", To: "tool:search", Source: &api.SourceLoc{File: "b.ts", Line: 1},
	}}}
	changed = store.ApplySnapshot("scope", replacement)
	assertStrings(t, changed, []string{"a.ts", "b.ts", "c.ts"})
	assertRelationIDs(t, store.Relations("scope"), []string{"relation:replacement"})

	changed = store.ApplySnapshot("scope", replacement)
	assertStrings(t, changed, []string{})

	changed = store.ApplySnapshot("scope", Snapshot{Generation: &generation, Relations: []api.ProjectRelation{{
		ID: "relation:replacement", Type: "calls", To: "tool:search", Source: &api.SourceLoc{File: "b.ts", Line: 1},
	}}})
	assertStrings(t, changed, []string{"b.ts"})

	changed = store.ApplySnapshot("scope", Snapshot{Generation: &generation, Relations: []api.ProjectRelation{{
		ID: "relation:replacement", Type: "calls", To: "tool:search", Source: &api.SourceLoc{File: "moved.ts", Line: 1},
	}}})
	assertStrings(t, changed, []string{"b.ts", "moved.ts"})
}

func relationByID(t *testing.T, relations []api.ProjectRelation, id string) api.ProjectRelation {
	t.Helper()
	for _, relation := range relations {
		if relation.ID == id {
			return relation
		}
	}
	t.Fatalf("relation %q not found in %#v", id, relations)
	return api.ProjectRelation{}
}

func assertRelationIDs(t *testing.T, relations []api.ProjectRelation, want []string) {
	t.Helper()
	got := make([]string, 0, len(relations))
	for _, relation := range relations {
		got = append(got, relation.ID)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("relation IDs = %v, want %v", got, want)
	}
}
