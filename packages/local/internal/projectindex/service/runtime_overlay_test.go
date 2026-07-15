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
		OwnerFacts: runtimeOwnerFacts("official-client", "catalog server", "1.0.0"),
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
		OwnerFacts: runtimeOwnerFacts("ai-sdk-native", "replacement server", "2.0.0"),
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

func TestRuntimeOwnerFactsTrackOnlyTheLastSuccessfulDiscovery(t *testing.T) {
	t.Parallel()

	service := New(Options{Store: store.NewStore()})
	service.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: t.TempDir()},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	}, projectindex.PhaseAST, "ok"))

	firstFailure, err := service.ApplyRuntimeUpdate(context.Background(), projectindex.ProjectIndexRuntimeUpdate{
		SchemaVersion: 1,
		Operation:     projectindex.RuntimeUpdateFailure,
		UpdateID:      "failure-before-success",
		Owner:         projectindex.RuntimeUpdateOwner{DefinitionID: "mcp.server:catalog", Kind: "mcp.server"},
		ObservedAt:    "2026-07-14T09:00:00Z",
		Error:         &projectindex.RuntimeUpdateError{Phase: "connect", Category: "mcp-connect"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if runtimeOverlayMetadata(t, firstFailure, "mcp.server:catalog").LastSuccessfulDiscovery != nil {
		t.Fatal("first failure fabricated a successful discovery")
	}

	zeroTools := runtimeToolUpdate("catalog", "zero-tools")
	zeroTools.ObservedAt = "2026-07-14T10:00:00Z"
	zeroTools.OwnerFacts = runtimeOwnerFacts("ai-sdk-native", "  catalog server  ", " 2.0.0 ")
	firstSuccess, err := service.ApplyRuntimeUpdate(context.Background(), zeroTools)
	if err != nil {
		t.Fatal(err)
	}
	assertLastSuccessfulDiscovery(t, firstSuccess, "mcp.server:catalog", zeroTools.ObservedAt, "ai-sdk-native", "catalog server")

	withoutOptionalIdentity := runtimeToolUpdate("catalog", "zero-tools-v2")
	withoutOptionalIdentity.ObservedAt = "2026-07-14T11:00:00Z"
	withoutOptionalIdentity.OwnerFacts = &projectindex.RuntimeOwnerFacts{
		Kind: "mcp.discovery", Implementation: "official-client",
	}
	latest, err := service.ApplyRuntimeUpdate(context.Background(), withoutOptionalIdentity)
	if err != nil {
		t.Fatal(err)
	}
	overlay := runtimeOverlayMetadata(t, latest, "mcp.server:catalog")
	if overlay.Revision != "zero-tools-v2" || overlay.LastSuccessfulDiscovery == nil ||
		overlay.LastSuccessfulDiscovery.ObservedAt != "2026-07-14T11:00:00Z" ||
		overlay.LastSuccessfulDiscovery.Implementation != "official-client" ||
		overlay.LastSuccessfulDiscovery.ProtocolVersion != nil || overlay.LastSuccessfulDiscovery.Server != nil {
		t.Fatalf("latest successful discovery combined handshake identities: %+v", overlay)
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
		OwnerFacts:    runtimeOwnerFacts("official-client", "catalog server", "1.0.0"),
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
	assertLastSuccessfulDiscovery(t, failed, "mcp.server:catalog", "2026-07-14T10:00:00Z", "official-client", "catalog server")

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
		OwnerFacts:    runtimeOwnerFacts("official-client", serverID+" server", "1.0.0"),
		ObservedAt:    "2026-07-14T10:00:00Z",
		Revision:      updateID,
		Definitions:   definitions,
		Relations:     relations,
	}
}

func runtimeOwnerFacts(implementation, name, version string) *projectindex.RuntimeOwnerFacts {
	return &projectindex.RuntimeOwnerFacts{
		Kind: "mcp.discovery", Implementation: implementation,
		ProtocolVersion: stringPointer("2025-06-18"),
		Server: &projectindex.RuntimeOwnerServerIdentity{
			Untrusted: true, Name: stringPointer(name), Version: stringPointer(version),
		},
	}
}

func stringPointer(value string) *string { return &value }

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

func assertLastSuccessfulDiscovery(
	t *testing.T,
	index store.IndexData,
	id, observedAt, implementation, serverName string,
) {
	t.Helper()
	definition := definitionByID(t, index, id)
	var metadata struct {
		RuntimeOverlay struct {
			ObservedAt              string `json:"observedAt"`
			LastSuccessfulDiscovery struct {
				ObservedAt     string `json:"observedAt"`
				Implementation string `json:"implementation"`
				Server         struct {
					Name string `json:"name"`
				} `json:"server"`
			} `json:"lastSuccessfulDiscovery"`
		} `json:"runtimeOverlay"`
	}
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("decode %s metadata: %v", id, err)
	}
	discovery := metadata.RuntimeOverlay.LastSuccessfulDiscovery
	if discovery.ObservedAt != observedAt || discovery.Implementation != implementation || discovery.Server.Name != serverName {
		t.Fatalf("server %s last successful discovery = %+v", id, discovery)
	}
}

type projectedRuntimeOverlay struct {
	Status                  string                                   `json:"status"`
	ObservedAt              string                                   `json:"observedAt"`
	Revision                string                                   `json:"revision"`
	LastSuccessfulDiscovery *projectindex.RuntimeSuccessfulDiscovery `json:"lastSuccessfulDiscovery"`
}

func runtimeOverlayMetadata(t *testing.T, index store.IndexData, id string) projectedRuntimeOverlay {
	t.Helper()
	definition := definitionByID(t, index, id)
	var metadata struct {
		RuntimeOverlay projectedRuntimeOverlay `json:"runtimeOverlay"`
	}
	if err := json.Unmarshal(definition.Metadata, &metadata); err != nil {
		t.Fatalf("decode %s metadata: %v", id, err)
	}
	return metadata.RuntimeOverlay
}
