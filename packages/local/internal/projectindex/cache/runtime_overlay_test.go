package cache_test

import (
	"context"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestSQLiteStorePersistsRuntimeOverlaysAndHydratesActiveChildrenAsStale(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	facts := cache.NewSQLiteIndexFactStore()
	overlay := model.RuntimeOverlay{
		Owner:      model.RuntimeUpdateOwner{DefinitionID: "mcp.server:catalog", Kind: "mcp.server"},
		ObservedAt: "2026-07-14T10:00:00Z",
		Revision:   "discovery-v1",
		LastSuccessfulDiscovery: &model.RuntimeSuccessfulDiscovery{
			ObservedAt:     "2026-07-14T09:59:00Z",
			Implementation: "official-client",
		},
		Definitions: []store.ProjectDefinition{
			{ID: "tool:lookup", Kind: "tool", Name: "lookup", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "catalog-lookup", Type: "mcp.server.provides_tool", From: "mcp.server:catalog", To: "tool:lookup", Fidelity: "resolved"},
		},
	}
	if err := facts.CommitRuntimeOverlay(context.Background(), root, overlay); err != nil {
		t.Fatalf("CommitRuntimeOverlay error = %v", err)
	}

	loaded, err := facts.LoadRuntimeOverlays(context.Background(), root)
	if err != nil {
		t.Fatalf("LoadRuntimeOverlays error = %v", err)
	}
	if len(loaded) != 1 || loaded[0].Revision != "discovery-v1" {
		t.Fatalf("loaded overlays = %+v", loaded)
	}
	if loaded[0].LastSuccessfulDiscovery == nil ||
		loaded[0].LastSuccessfulDiscovery.ObservedAt != "2026-07-14T09:59:00Z" {
		t.Fatalf("loaded discovery identity = %+v", loaded[0].LastSuccessfulDiscovery)
	}

	restarted := model.NewRuntimeOverlayState()
	restarted.Hydrate(loaded, true)
	projected := restarted.Project(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	})
	if len(projected.Definitions) != 2 || projected.Definitions[1].Status != "stale" {
		t.Fatalf("restarted definitions = %+v, want stale runtime child", projected.Definitions)
	}
}
