package service

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestApplyRuntimeUpdateReplacesOneMCPServerOverlay(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	indexStore := store.NewStore()
	service := New(Options{Store: indexStore})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "runtime-overlay"},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial", Fingerprint: "server-v1"},
			{ID: "tool:alpha", Kind: "tool", Name: "alpha", Fidelity: "partial"},
		},
		Relations: []store.ProjectRelation{
			mcpToolRelation("authored-catalog-alpha", "mcp.server:catalog", "tool:alpha"),
		},
	}, projectindex.PhaseAST, "ok"))

	first, err := service.ApplyRuntimeUpdate(context.Background(), projectindex.ProjectIndexRuntimeUpdate{
		SchemaVersion: 1,
		Operation:     projectindex.RuntimeUpdateReplace,
		UpdateID:      "update-1",
		Owner: projectindex.RuntimeUpdateOwner{
			DefinitionID: "mcp.server:catalog",
			Kind:         "mcp.server",
		},
		ObservedAt: "2026-07-14T10:00:00Z",
		Revision:   "discovery-v1",
		Definitions: []store.ProjectDefinition{
			mcpToolDefinition("tool:alpha", "catalog", "alpha", "resolved", "alpha-v1", "discovery-v1", "2026-07-14T10:00:00Z"),
			mcpToolDefinition("tool:beta", "catalog", "beta", "resolved", "beta-v1", "discovery-v1", "2026-07-14T10:00:00Z"),
		},
		Relations: []store.ProjectRelation{
			mcpToolRelation("catalog-alpha", "mcp.server:catalog", "tool:alpha"),
			mcpToolRelation("catalog-beta", "mcp.server:catalog", "tool:beta"),
		},
	})
	if err != nil {
		t.Fatalf("first ApplyRuntimeUpdate error = %v", err)
	}
	assertDefinitionStatus(t, first, "tool:alpha", "active")
	assertDefinitionStatus(t, first, "tool:beta", "active")

	second, err := service.ApplyRuntimeUpdate(context.Background(), projectindex.ProjectIndexRuntimeUpdate{
		SchemaVersion: 1,
		Operation:     projectindex.RuntimeUpdateReplace,
		UpdateID:      "update-2",
		Owner: projectindex.RuntimeUpdateOwner{
			DefinitionID: "mcp.server:catalog",
			Kind:         "mcp.server",
		},
		ObservedAt: "2026-07-14T10:05:00Z",
		Revision:   "discovery-v2",
		Definitions: []store.ProjectDefinition{
			mcpToolDefinition("tool:beta", "catalog", "beta", "resolved", "beta-v2", "discovery-v2", "2026-07-14T10:05:00Z"),
			mcpToolDefinition("tool:gamma", "catalog", "gamma", "resolved", "gamma-v1", "discovery-v2", "2026-07-14T10:05:00Z"),
		},
		Relations: []store.ProjectRelation{
			mcpToolRelation("catalog-beta", "mcp.server:catalog", "tool:beta"),
			mcpToolRelation("catalog-gamma", "mcp.server:catalog", "tool:gamma"),
		},
	})
	if err != nil {
		t.Fatalf("second ApplyRuntimeUpdate error = %v", err)
	}

	assertDefinitionStatus(t, second, "tool:alpha", "removed")
	assertDefinitionStatus(t, second, "tool:beta", "active")
	assertDefinitionStatus(t, second, "tool:gamma", "active")
	if got := definitionByID(t, second, "tool:beta").Fingerprint; got != "beta-v2" {
		t.Fatalf("tool:beta fingerprint = %q, want beta-v2", got)
	}
	assertRelation(t, second, "mcp.server:catalog", "tool:alpha")
	assertRelation(t, second, "mcp.server:catalog", "tool:beta")
	assertRelation(t, second, "mcp.server:catalog", "tool:gamma")
	tombstone := definitionByID(t, second, "tool:alpha")
	if tombstone.Description != "" || len(tombstone.Tags) != 0 || tombstone.Quality != nil {
		t.Fatalf("tool:alpha tombstone retained non-contract fields: %+v", tombstone)
	}
}

func TestApplyRuntimeUpdateFailsClosedWhenOverlayCannotPersist(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	indexStore := store.NewStore()
	service := New(Options{Store: indexStore})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	}, projectindex.PhaseAST, "ok"))
	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}

	if _, err := service.ApplyRuntimeUpdate(context.Background(), runtimeToolUpdate("catalog", "unpersisted", "lookup")); err == nil {
		t.Fatal("ApplyRuntimeUpdate succeeded after persistence root was removed")
	}
	if hasDefinition(indexStore.GetIndex(), "tool:lookup") {
		t.Fatal("unpersisted runtime tool was published")
	}
}

func TestApplyRuntimeUpdateRejectsContradictoryDiscoveryEnvelope(t *testing.T) {
	t.Parallel()

	service := New(Options{Store: store.NewStore()})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: t.TempDir()},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	}, projectindex.PhaseAST, "ok"))
	update := runtimeToolUpdate("catalog", "discovery-v1", "lookup")
	var metadata map[string]any
	if err := json.Unmarshal(update.Definitions[0].Metadata, &metadata); err != nil {
		t.Fatal(err)
	}
	metadata["mcpDiscovery"].(map[string]any)["toolListFingerprint"] = "different-revision"
	update.Definitions[0].Metadata, _ = json.Marshal(metadata)

	if _, err := service.ApplyRuntimeUpdate(context.Background(), update); err == nil ||
		!projectindex.IsRuntimeUpdateValidationError(err) {
		t.Fatalf("contradictory discovery error = %T %v", err, err)
	}
}

func TestApplyRuntimeUpdateFailurePreservesAndStalesLastKnownChildren(t *testing.T) {
	t.Parallel()

	service := New(Options{Store: store.NewStore()})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: t.TempDir()},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	}, projectindex.PhaseAST, "ok"))
	_, err := service.ApplyRuntimeUpdate(context.Background(), projectindex.ProjectIndexRuntimeUpdate{
		SchemaVersion: 1,
		Operation:     projectindex.RuntimeUpdateReplace,
		UpdateID:      "success-1",
		Owner:         projectindex.RuntimeUpdateOwner{DefinitionID: "mcp.server:catalog", Kind: "mcp.server"},
		ObservedAt:    "2026-07-14T10:00:00Z",
		Revision:      "discovery-v1",
		Definitions: []store.ProjectDefinition{
			mcpToolDefinition("tool:alpha", "catalog", "alpha", "resolved", "alpha-v1", "discovery-v1", "2026-07-14T10:00:00Z"),
		},
		Relations: []store.ProjectRelation{
			mcpToolRelation("catalog-alpha", "mcp.server:catalog", "tool:alpha"),
		},
	})
	if err != nil {
		t.Fatalf("successful ApplyRuntimeUpdate error = %v", err)
	}

	failed, err := service.ApplyRuntimeUpdate(context.Background(), projectindex.ProjectIndexRuntimeUpdate{
		SchemaVersion: 1,
		Operation:     projectindex.RuntimeUpdateFailure,
		UpdateID:      "failure-1",
		Owner:         projectindex.RuntimeUpdateOwner{DefinitionID: "mcp.server:catalog", Kind: "mcp.server"},
		ObservedAt:    "2026-07-14T10:05:00Z",
		Error:         &projectindex.RuntimeUpdateError{Phase: "discover", Category: "mcp-discovery"},
	})
	if err != nil {
		t.Fatalf("failed ApplyRuntimeUpdate error = %v", err)
	}
	assertDefinitionStatus(t, failed, "tool:alpha", "stale")
	assertRelation(t, failed, "mcp.server:catalog", "tool:alpha")
	assertServerRuntimeHealth(t, failed, "mcp.server:catalog", "error")

	_, err = service.ApplyRuntimeUpdate(context.Background(), projectindex.ProjectIndexRuntimeUpdate{
		SchemaVersion: 1,
		Operation:     projectindex.RuntimeUpdateFailure,
		UpdateID:      "invalid-partial-failure",
		Owner:         projectindex.RuntimeUpdateOwner{DefinitionID: "mcp.server:catalog", Kind: "mcp.server"},
		ObservedAt:    "2026-07-14T10:06:00Z",
		Definitions: []store.ProjectDefinition{
			mcpToolDefinition("tool:partial", "catalog", "partial", "resolved", "partial-v1", "unused", "2026-07-14T10:06:00Z"),
		},
		Error: &projectindex.RuntimeUpdateError{Phase: "discover", Category: "mcp-discovery"},
	})
	if err == nil {
		t.Fatal("failure update with partial definitions succeeded")
	}
}

func applyRuntimeTools(t *testing.T, service *Service, serverID, updateID string, names ...string) store.IndexData {
	t.Helper()
	index, err := service.ApplyRuntimeUpdate(context.Background(), runtimeToolUpdate(serverID, updateID, names...))
	if err != nil {
		t.Fatalf("ApplyRuntimeUpdate(%s) error = %v", updateID, err)
	}
	return index
}

func runtimeToolUpdate(serverID, updateID string, names ...string) projectindex.ProjectIndexRuntimeUpdate {
	definitions := make([]store.ProjectDefinition, 0, len(names))
	relations := make([]store.ProjectRelation, 0, len(names))
	for _, name := range names {
		definitions = append(definitions, mcpToolDefinition("tool:"+name, serverID, name, "resolved", updateID+":"+name, updateID, "2026-07-14T10:00:00Z"))
		relations = append(relations, mcpToolRelation(serverID+"-"+name, "mcp.server:"+serverID, "tool:"+name))
	}
	return projectindex.ProjectIndexRuntimeUpdate{
		SchemaVersion: 1,
		Operation:     projectindex.RuntimeUpdateReplace,
		UpdateID:      updateID,
		Owner:         projectindex.RuntimeUpdateOwner{DefinitionID: "mcp.server:" + serverID, Kind: "mcp.server"},
		ObservedAt:    "2026-07-14T10:00:00Z",
		Revision:      updateID,
		Definitions:   definitions,
		Relations:     relations,
	}
}

func mcpToolDefinition(id, serverID, remoteName, fidelity, fingerprint, revision, observedAt string) store.ProjectDefinition {
	metadata, _ := json.Marshal(map[string]any{
		"inputSchema": map[string]any{"type": "object"},
		"facts": map[string]any{
			"kind":     "tool",
			"toolName": remoteName,
			"mcp": map[string]any{
				"serverId":    serverID,
				"remoteName":  remoteName,
				"exposedName": remoteName,
				"provenance":  "runtime-discovered",
			},
		},
		"mcpDiscovery": map[string]any{
			"observedAt":             observedAt,
			"toolListFingerprint":    revision,
			"inputSchemaFingerprint": "input-v1",
		},
	})
	return store.ProjectDefinition{
		ID: id, Kind: "tool", Name: remoteName, Fidelity: fidelity,
		Description: "runtime description", Fingerprint: fingerprint, Metadata: metadata,
	}
}

func mcpToolRelation(id, ownerID, toolID string) store.ProjectRelation {
	return store.ProjectRelation{
		ID: id, Type: "mcp.server.provides_tool", From: ownerID, To: toolID, Fidelity: "resolved",
	}
}

func assertDefinitionStatus(t *testing.T, index store.IndexData, id, status string) {
	t.Helper()
	if got := definitionByID(t, index, id).Status; got != status {
		t.Fatalf("definition %s status = %q, want %q", id, got, status)
	}
}

func definitionByID(t *testing.T, index store.IndexData, id string) store.ProjectDefinition {
	t.Helper()
	for _, definition := range index.Definitions {
		if definition.ID == id {
			return definition
		}
	}
	t.Fatalf("definition %s not found", id)
	return store.ProjectDefinition{}
}

func hasDefinition(index store.IndexData, id string) bool {
	for _, definition := range index.Definitions {
		if definition.ID == id {
			return true
		}
	}
	return false
}

func assertRelation(t *testing.T, index store.IndexData, from, to string) {
	t.Helper()
	for _, relation := range index.Relations {
		if relation.Type == "mcp.server.provides_tool" && relation.From == from && relation.To == to {
			return
		}
	}
	t.Fatalf("relation %s -> %s not found", from, to)
}

func assertServerRuntimeHealth(t *testing.T, index store.IndexData, id, status string) {
	t.Helper()
	definition := definitionByID(t, index, id)
	var metadata struct {
		RuntimeOverlay struct {
			Status string `json:"status"`
		} `json:"runtimeOverlay"`
	}
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("decode %s metadata: %v", id, err)
	}
	if metadata.RuntimeOverlay.Status != status {
		t.Fatalf("server %s runtime health = %q, want %q", id, metadata.RuntimeOverlay.Status, status)
	}
}
