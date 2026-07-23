package readmodel

import (
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestStoreMergesDetachedSortedNavigationSitesFromSnapshot(t *testing.T) {
	store := NewStore()
	generation := uint64(1)
	columnOne, columnThree := 1, 3
	relationSource := &api.SourceLoc{File: "b.ts", Line: 2, Column: &columnThree}
	refSource := api.SourceLoc{File: "b.ts", Line: 2, Column: &columnThree}

	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Relations: []api.ProjectRelation{
			{ID: "relation:b", To: "tool:search", Source: relationSource},
			{ID: "relation:a-z", To: "tool:search", Source: &api.SourceLoc{File: "a.ts", Line: 1, Column: &columnOne}},
			{ID: "relation:a-a", To: "tool:search", Source: &api.SourceLoc{File: "a.ts", Line: 1, Column: &columnOne}},
			{ID: "site:tie", To: "target:z", Source: &api.SourceLoc{File: "tie.ts", Line: 1}},
			{ID: "site:tie", To: "target:a", Source: &api.SourceLoc{File: "tie.ts", Line: 1}},
			{ID: "relation:nil", To: "tool:search"},
			{ID: "relation:no-file", To: "tool:search", Source: &api.SourceLoc{Line: 1}},
			{ID: "relation:no-line", To: "tool:search", Source: &api.SourceLoc{File: "a.ts"}},
		},
		Definitions: []api.ProjectDefinition{
			{
				ID: "tool:search",
				SourceRefs: []api.ProjectSourceRef{
					{ID: "ref:no-column", Role: "schema", Source: api.SourceLoc{File: "a.ts", Line: 1}},
					{ID: "ref:b", Role: "callback", Source: refSource},
					{ID: "ref:tie", Role: "schema", Source: api.SourceLoc{File: "a.ts", Line: 3, Function: "zeta"}},
					{ID: "ref:tie", Role: "schema", Source: api.SourceLoc{File: "a.ts", Line: 3, Function: "alpha"}},
					{ID: "ref:no-file", Role: "schema", Source: api.SourceLoc{Line: 1}},
				},
			},
			{
				ID: "context:brand",
				SourceRefs: []api.ProjectSourceRef{{
					ID: "ref:brand", Role: "value", Source: api.SourceLoc{File: "a.ts", Line: 2},
				}},
			},
			{
				ID: "target:a",
				SourceRefs: []api.ProjectSourceRef{
					{ID: "site:tie", Role: "zeta", Source: api.SourceLoc{File: "tie.ts", Line: 1}},
					{ID: "site:tie", Role: "alpha", Source: api.SourceLoc{File: "tie.ts", Line: 1}},
				},
			},
		},
	})

	relationSource.File = "mutated.ts"
	columnThree = 99
	refSource.File = "mutated.ts"

	assertNavigationSiteIDs(t, store.ReferencesTo("scope", "tool:search"), []string{
		"ref:no-column", "relation:a-a", "relation:a-z", "ref:tie", "ref:tie", "ref:b", "relation:b",
	})
	assertNavigationSiteIDs(t, store.SitesInFile("scope", "a.ts"), []string{
		"ref:no-column", "relation:a-a", "relation:a-z", "ref:brand", "ref:tie", "ref:tie",
	})
	assertNavigationSiteFunctions(t, store.SitesInFile("scope", "a.ts"), "ref:tie", []string{"alpha", "zeta"})
	wantTies := []NavigationSite{
		{ID: "site:tie", TargetDefinitionID: "target:a", Source: api.SourceLoc{File: "tie.ts", Line: 1}},
		{ID: "site:tie", TargetDefinitionID: "target:a", Role: "alpha", Source: api.SourceLoc{File: "tie.ts", Line: 1}},
		{ID: "site:tie", TargetDefinitionID: "target:a", Role: "zeta", Source: api.SourceLoc{File: "tie.ts", Line: 1}},
		{ID: "site:tie", TargetDefinitionID: "target:z", Source: api.SourceLoc{File: "tie.ts", Line: 1}},
	}
	if got := store.SitesInFile("scope", "tie.ts"); !reflect.DeepEqual(got, wantTies) {
		t.Fatalf("navigation site tie-break order = %#v, want %#v", got, wantTies)
	}
	if got := store.SitesInFile("scope", ""); len(got) != 0 {
		t.Fatalf("unusable sites appeared in empty-file lookup: %#v", got)
	}

	searchSites := store.ReferencesTo("scope", "tool:search")
	ref := navigationSiteByID(t, searchSites, "ref:b")
	if ref.TargetDefinitionID != "tool:search" || ref.Role != "callback" ||
		ref.Source.File != "b.ts" || ref.Source.Column == nil || *ref.Source.Column != 3 {
		t.Fatalf("source-ref site = %#v", ref)
	}
	relation := navigationSiteByID(t, searchSites, "relation:b")
	if relation.TargetDefinitionID != "tool:search" || relation.Role != "" ||
		relation.Source.File != "b.ts" || relation.Source.Column == nil || *relation.Source.Column != 3 {
		t.Fatalf("relation site = %#v", relation)
	}

	*ref.Source.Column = 77
	ref.Source.File = "returned-mutation.ts"
	again := navigationSiteByID(t, store.ReferencesTo("scope", "tool:search"), "ref:b")
	if again.Source.File != "b.ts" || again.Source.Column == nil || *again.Source.Column != 3 {
		t.Fatalf("returned site aliases stored source: %#v", again)
	}
}

func TestDefinitionDeltaRebuildsSourceRefSitesAndPreservesRelationSites(t *testing.T) {
	store := NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", Snapshot{
		Generation: &generation,
		Relations: []api.ProjectRelation{{
			ID: "relation:kept", To: "tool:search", Source: &api.SourceLoc{File: "relation.ts", Line: 1},
		}},
		Definitions: []api.ProjectDefinition{
			{
				ID: "tool:search",
				SourceRefs: []api.ProjectSourceRef{{
					ID: "ref:old", Role: "schema", Source: api.SourceLoc{File: "old.ts", Line: 1},
				}},
			},
			{
				ID: "context:removed",
				SourceRefs: []api.ProjectSourceRef{{
					ID: "ref:removed", Role: "value", Source: api.SourceLoc{File: "removed.ts", Line: 1},
				}},
			},
		},
	})

	result := store.ApplyDelta("scope", Delta{
		Generation: 2,
		File:       "changed.ts",
		Definitions: DefinitionChanges{
			Changed: []api.ProjectDefinition{{
				ID: "tool:search",
				SourceRefs: []api.ProjectSourceRef{{
					ID: "ref:new", Role: "callback", Source: api.SourceLoc{File: "new.ts", Line: 2},
				}},
			}},
			RemovedIDs: []string{"context:removed"},
		},
	})
	if result.Status != DeltaApplied {
		t.Fatalf("definition delta status = %v, want applied", result.Status)
	}
	assertNavigationSiteIDs(t, store.ReferencesTo("scope", "tool:search"), []string{
		"ref:new", "relation:kept",
	})
	if got := store.SitesInFile("scope", "old.ts"); len(got) != 0 {
		t.Fatalf("changed definition retained old source-ref sites: %#v", got)
	}
	if got := store.ReferencesTo("scope", "context:removed"); len(got) != 0 {
		t.Fatalf("removed definition retained source-ref sites: %#v", got)
	}
	assertNavigationSiteIDs(t, store.SitesInFile("scope", "relation.ts"), []string{"relation:kept"})
}

func navigationSiteByID(t *testing.T, sites []NavigationSite, id string) NavigationSite {
	t.Helper()
	for _, site := range sites {
		if site.ID == id {
			return site
		}
	}
	t.Fatalf("navigation site %q not found in %#v", id, sites)
	return NavigationSite{}
}

func assertNavigationSiteIDs(t *testing.T, sites []NavigationSite, want []string) {
	t.Helper()
	got := make([]string, 0, len(sites))
	for _, site := range sites {
		got = append(got, site.ID)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("navigation site IDs = %v, want %v", got, want)
	}
}

func assertNavigationSiteFunctions(t *testing.T, sites []NavigationSite, id string, want []string) {
	t.Helper()
	got := make([]string, 0, len(want))
	for _, site := range sites {
		if site.ID == id {
			got = append(got, site.Source.Function)
		}
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("navigation site functions for %q = %v, want %v", id, got, want)
	}
}
