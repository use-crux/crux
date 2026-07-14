package service

import (
	"context"
	"errors"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/projectindex/cache"
	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestApplyRuntimeUpdateIsolatesOwnersAndRejectsGlobalToolCollisions(t *testing.T) {
	t.Parallel()

	indexStore := store.NewStore()
	service := New(Options{Store: indexStore})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: t.TempDir()},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:a", Kind: "mcp.server", Name: "a", Fidelity: "partial"},
			{ID: "mcp.server:b", Kind: "mcp.server", Name: "b", Fidelity: "partial"},
			{ID: "tool:authored", Kind: "tool", Name: "authored", Fidelity: "resolved"},
		},
	}, projectindex.PhaseAST, "ok"))

	applyRuntimeTools(t, service, "a", "a-1", "alpha")
	applyRuntimeTools(t, service, "b", "b-1", "beta")
	isolated := applyRuntimeTools(t, service, "a", "a-2", "gamma")
	assertDefinitionStatus(t, isolated, "tool:alpha", "removed")
	assertDefinitionStatus(t, isolated, "tool:gamma", "active")
	assertDefinitionStatus(t, isolated, "tool:beta", "active")

	_, err := service.ApplyRuntimeUpdate(context.Background(), runtimeToolUpdate("a", "a-collision", "beta"))
	if err == nil {
		t.Fatal("cross-owner collision succeeded")
	}
	if !projectindex.IsRuntimeUpdateConflict(err) {
		t.Fatalf("collision error = %T %v, want RuntimeUpdateConflictError", err, err)
	}
	afterCollision := indexStore.GetIndex()
	assertDefinitionStatus(t, afterCollision, "tool:gamma", "stale")
	assertDefinitionStatus(t, afterCollision, "tool:beta", "active")
	assertRuntimeCollisionDiagnostic(t, afterCollision, "mcp.server:a", "mcp.server:b", "tool:beta")

	_, err = service.ApplyRuntimeUpdate(context.Background(), runtimeToolUpdate("a", "authored-collision", "authored"))
	if err == nil || !projectindex.IsRuntimeUpdateConflict(err) {
		t.Fatalf("authored collision error = %T %v, want RuntimeUpdateConflictError", err, err)
	}
}

func TestAuthoritativeReindexHydratesOverlayWithoutBaseSnapshotHit(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	facts := cache.NewSQLiteIndexFactStore()
	if err := facts.CommitRuntimeOverlay(context.Background(), root, model.RuntimeOverlay{
		Owner:            model.RuntimeUpdateOwner{DefinitionID: "mcp.server:catalog", Kind: "mcp.server"},
		OwnerFingerprint: "server-v1",
		ObservedAt:       "2026-07-14T10:00:00Z",
		Revision:         "discovery-v1",
		Definitions: []store.ProjectDefinition{
			func() store.ProjectDefinition {
				definition := mcpToolDefinition("tool:lookup", "catalog", "lookup", "resolved", "lookup-v1", "discovery-v1", "2026-07-14T10:00:00Z")
				definition.Status = "active"
				return definition
			}(),
		},
		Relations: []store.ProjectRelation{
			mcpToolRelation("catalog-lookup", "mcp.server:catalog", "tool:lookup"),
		},
	}); err != nil {
		t.Fatal(err)
	}

	indexer := &runtimeOverlayASTIndexer{root: root, serverFingerprint: "server-v1", includeServer: true}
	service := New(Options{Store: store.NewStore(), Indexer: indexer, FactStore: facts})
	index, err := service.ReindexProject(context.Background(), root, "", "overlay-cache-miss")
	if err != nil {
		t.Fatal(err)
	}
	assertDefinitionStatus(t, index, "tool:lookup", "stale")
}

func TestAuthoritativeReindexReconcilesRuntimeOverlayByServerFingerprint(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	indexer := &runtimeOverlayASTIndexer{root: root, serverFingerprint: "server-v1", includeServer: true}
	service := New(Options{Store: store.NewStore(), Indexer: indexer})
	if _, err := service.ReindexProject(context.Background(), root, "", "overlay-reindex"); err != nil {
		t.Fatalf("initial ReindexProject error = %v", err)
	}
	applyRuntimeTools(t, service, "catalog", "discovery-v1", "lookup")

	restarted := New(Options{Store: store.NewStore(), Indexer: indexer})
	restartedIndex, err := restarted.ReindexProject(context.Background(), root, "", "overlay-reindex")
	if err != nil {
		t.Fatalf("restart ReindexProject error = %v", err)
	}
	assertDefinitionStatus(t, restartedIndex, "tool:lookup", "stale")
	applyRuntimeTools(t, restarted, "catalog", "discovery-after-restart", "lookup")

	unchanged, err := restarted.ReindexProject(context.Background(), root, "", "overlay-reindex")
	if err != nil {
		t.Fatalf("unchanged ReindexProject error = %v", err)
	}
	assertDefinitionStatus(t, unchanged, "tool:lookup", "active")
	indexer.failure = errors.New("temporary AST failure")
	if _, err := restarted.ReindexProject(context.Background(), root, "", "overlay-reindex"); err == nil {
		t.Fatal("temporary failed ReindexProject succeeded")
	}
	assertDefinitionStatus(t, restarted.store.GetIndex(), "tool:lookup", "active")
	indexer.failure = nil

	indexer.serverFingerprint = "server-v2"
	changed, err := restarted.ReindexProject(context.Background(), root, "", "overlay-reindex")
	if err != nil {
		t.Fatalf("changed ReindexProject error = %v", err)
	}
	assertDefinitionStatus(t, changed, "tool:lookup", "stale")

	applyRuntimeTools(t, restarted, "catalog", "discovery-v2", "lookup")
	indexer.includeServer = false
	removed, err := restarted.ReindexProject(context.Background(), root, "", "overlay-reindex")
	if err != nil {
		t.Fatalf("removing ReindexProject error = %v", err)
	}
	if hasDefinition(removed, "tool:lookup") {
		t.Fatalf("removed server overlay survived: %+v", removed.Definitions)
	}

	indexer.includeServer = true
	reintroduced := New(Options{Store: store.NewStore(), Indexer: indexer})
	reintroducedIndex, err := reintroduced.ReindexProject(context.Background(), root, "", "overlay-reindex")
	if err != nil {
		t.Fatalf("reintroduced ReindexProject error = %v", err)
	}
	if hasDefinition(reintroducedIndex, "tool:lookup") {
		t.Fatalf("deleted overlay resurrected after reintroduction: %+v", reintroducedIndex.Definitions)
	}

	indexer.failure = errors.New("synthetic AST failure")
	beforeFailure := reintroduced.indexState.Index()
	if _, err := reintroduced.ReindexProject(context.Background(), root, "", "overlay-reindex"); err == nil {
		t.Fatal("failed ReindexProject succeeded")
	}
	if got := reintroduced.indexState.Index(); len(got.Definitions) != len(beforeFailure.Definitions) {
		t.Fatalf("failed reindex base definitions = %+v, want previous %+v", got.Definitions, beforeFailure.Definitions)
	}
}

func TestIncompleteASTOmissionPreservesRuntimeOverlay(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	service := New(Options{Store: store.NewStore()})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	}, projectindex.PhaseAST, "ok"))
	applyRuntimeTools(t, service, "catalog", "discovery-v1", "lookup")

	incomplete := service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:index:source-only", Code: "index.source_only", Severity: "warning"},
		},
	}, projectindex.PhaseAST, "ok"))

	assertDefinitionStatus(t, incomplete, "tool:lookup", "active")
	if !hasDefinition(incomplete, "mcp.server:catalog") {
		t.Fatal("incomplete AST omission dropped the authored MCP owner")
	}
	relationFound := false
	for _, relation := range incomplete.Relations {
		if relation.From == "mcp.server:catalog" && relation.To == "tool:lookup" {
			relationFound = true
			break
		}
	}
	if !relationFound {
		t.Fatalf("incomplete AST omission dropped the owner relation: %+v", incomplete.Relations)
	}
	updated := applyRuntimeTools(t, service, "catalog", "discovery-v2", "lookup")
	assertDefinitionStatus(t, updated, "tool:lookup", "active")
}

func TestFullReindexSourceOnlyCacheMissPreservesCompilerBaseAndOverlay(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	indexer := &runtimeOverlayASTIndexer{root: root, serverFingerprint: "server-v1", includeServer: true}
	service := New(Options{Store: store.NewStore(), Indexer: indexer})
	if _, err := service.ReindexProject(context.Background(), root, "", "source-only-preserve"); err != nil {
		t.Fatalf("initial ReindexProject error = %v", err)
	}
	applyRuntimeTools(t, service, "catalog", "discovery-v1", "lookup")
	service.WithFactStore(nil)
	indexer.sourceOnly = true

	incomplete, err := service.ReindexProject(context.Background(), root, "", "source-only-preserve")
	if err != nil {
		t.Fatalf("source-only ReindexProject error = %v", err)
	}
	if !hasDefinition(incomplete, "mcp.server:catalog") || !hasDefinition(incomplete, "tool:lookup") {
		t.Fatalf("source-only full reindex dropped owner or tool: %+v", incomplete.Definitions)
	}
	updated := applyRuntimeTools(t, service.WithFactStore(cache.NewSQLiteIndexFactStore()), "catalog", "discovery-v2", "lookup")
	assertDefinitionStatus(t, updated, "tool:lookup", "active")
}

func TestAuthoritativeRemovalRetiresRegisteredOwnerAndPreventsResurrection(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	service := New(Options{Store: store.NewStore()})
	service.RegisterRuntimeSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	}, projectindex.PhaseAST, "ok"))
	applyRuntimeTools(t, service, "catalog", "discovery-v1", "lookup")

	removed := service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
	}, projectindex.PhaseAST, "ok"))
	if hasDefinition(removed, "mcp.server:catalog") || hasDefinition(removed, "tool:lookup") {
		t.Fatalf("authoritatively removed owner survived: %+v", removed.Definitions)
	}
	if _, err := service.ApplyRuntimeUpdate(context.Background(), runtimeToolUpdate("catalog", "discovery-v2", "lookup")); err == nil {
		t.Fatal("runtime update resurrected an authoritatively removed owner")
	}
	service.RegisterRuntimeSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	})
	if _, err := service.ApplyRuntimeUpdate(context.Background(), runtimeToolUpdate("catalog", "discovery-v3", "lookup")); err == nil {
		t.Fatal("later startup snapshot resurrected an authoritatively removed owner")
	}
}

type runtimeOverlayASTIndexer struct {
	root              string
	serverFingerprint string
	includeServer     bool
	sourceOnly        bool
	failure           error
}

func (i *runtimeOverlayASTIndexer) IndexProjectAstPatch(
	context.Context,
	string,
	string,
	string,
) (projectindex.IndexPatch, error) {
	if i.failure != nil {
		return projectindex.IndexPatch{}, i.failure
	}
	if i.sourceOnly {
		return projectindex.PatchFromSnapshot(store.IndexData{
			SchemaVersion: 1,
			Project:       &store.ProjectIdentity{Root: i.root, Name: "overlay-reindex"},
			Diagnostics: []store.IndexDiagnostic{
				{ID: "diagnostic:index:source-only", Code: "index.source_only", Severity: "warning"},
			},
		}, projectindex.PhaseAST, "ok"), nil
	}
	definitions := []store.ProjectDefinition{}
	if i.includeServer {
		definitions = append(definitions, store.ProjectDefinition{
			ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog",
			Fidelity: "partial", Fingerprint: i.serverFingerprint,
		})
	}
	return projectindex.IndexPatch{
		SchemaVersion: 1,
		Phase:         projectindex.PhaseAST,
		Project:       store.ProjectIdentity{Root: i.root, Name: "overlay-reindex"},
		FinishedAt:    "2026-07-14T10:00:00Z",
		Status:        "ok",
		Invalidates:   &projectindex.IndexPatchInvalidation{All: true},
		Facts:         projectindex.IndexPatchFacts{Definitions: definitions},
	}, nil
}

func assertRuntimeCollisionDiagnostic(t *testing.T, index store.IndexData, ownerA, ownerB, toolID string) {
	t.Helper()
	for _, diagnostic := range index.Diagnostics {
		if diagnostic.Code != "mcp.tool_name_collision" {
			continue
		}
		if len(diagnostic.RelatedDefinitionIDs) != 3 ||
			diagnostic.RelatedDefinitionIDs[0] != ownerA ||
			diagnostic.RelatedDefinitionIDs[1] != ownerB ||
			diagnostic.RelatedDefinitionIDs[2] != toolID {
			t.Fatalf("collision diagnostic refs = %v", diagnostic.RelatedDefinitionIDs)
		}
		return
	}
	t.Fatal("mcp.tool_name_collision diagnostic not found")
}
