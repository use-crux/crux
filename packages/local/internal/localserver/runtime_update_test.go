package localserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/inspect"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestRuntimeUpdateRouteAppliesOwnerScopedReplacement(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	indexStore := store.NewStore()
	devtoolsService := devtools.NewService(
		indexStore,
		inspect.NewService(indexStore, inspect.Dir(t.TempDir())),
	)
	devtoolsService.ApplyIndexPatch(context.Background(), projectindex.PatchFromSnapshot(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
			{ID: "tool:authored", Kind: "tool", Name: "authored", Fidelity: "resolved"},
		},
	}, projectindex.PhaseAST, "ok"))

	server := httptest.NewServer(New(Options{
		Devtools:      devtoolsService,
		OriginAllowed: func(*http.Request) bool { return true },
	}))
	t.Cleanup(server.Close)

	body := []byte(`{
    "schemaVersion": 1,
    "operation": "replace",
    "updateId": "runtime-route-1",
    "owner": {"definitionId": "mcp.server:catalog", "kind": "mcp.server"},
    "ownerFacts": {"kind":"mcp.discovery","implementation":"official-client","protocolVersion":" 2025-06-18 ","server":{"untrusted":true,"name":" catalog server ","version":" 1.0.0 "}},
    "observedAt": "2026-07-14T10:00:00Z",
    "revision": "discovery-v1",
    "definitions": [{
      "id": "tool:lookup",
      "kind": "tool",
      "name": "lookup",
      "fidelity": "resolved",
      "fingerprint": "lookup-v1",
      "metadata": {"inputSchema":{"type":"object"},"facts": {"kind": "tool", "toolName": "lookup", "mcp": {
        "serverId": "catalog",
        "remoteName": "lookup",
        "exposedName": "lookup",
        "provenance": "runtime-discovered"
      }},"mcpDiscovery":{"observedAt":"2026-07-14T10:00:00Z","toolListFingerprint":"discovery-v1","inputSchemaFingerprint":"input-v1"}}
    }],
    "relations": [{
      "id": "relation:catalog-lookup",
      "type": "mcp.server.provides_tool",
      "from": "mcp.server:catalog",
      "to": "tool:lookup",
      "fidelity": "resolved"
    }]
  }`)
	assertStatusAndClose(t, http.MethodPost, server.URL+"/api/index/runtime-update", body, http.StatusNoContent)

	response := assertStatus(t, http.MethodGet, server.URL+"/api/index", nil, http.StatusOK)
	defer response.Body.Close()
	var index store.IndexData
	if err := json.NewDecoder(response.Body).Decode(&index); err != nil {
		t.Fatal(err)
	}
	assertRuntimeDefinition(t, index, "tool:lookup", "active")

	collision := []byte(`{
    "schemaVersion": 1,
    "operation": "replace",
    "updateId": "runtime-route-collision",
    "owner": {"definitionId": "mcp.server:catalog", "kind": "mcp.server"},
    "ownerFacts": {"kind":"mcp.discovery","implementation":"ai-sdk-native"},
    "observedAt": "2026-07-14T10:05:00Z",
    "revision": "discovery-v2",
    "definitions": [{"id":"tool:authored","kind":"tool","name":"authored","fidelity":"resolved","fingerprint":"authored-v1",
      "metadata":{"inputSchema":{"type":"object"},"facts":{"kind":"tool","toolName":"authored","mcp":{"serverId":"catalog","remoteName":"authored","exposedName":"authored","provenance":"runtime-discovered"}},
      "mcpDiscovery":{"observedAt":"2026-07-14T10:05:00Z","toolListFingerprint":"discovery-v2","inputSchemaFingerprint":"input-v2"}}}],
    "relations": [{"id":"collision","type":"mcp.server.provides_tool","from":"mcp.server:catalog","to":"tool:authored","fidelity":"resolved"}]
  }`)
	assertStatusAndClose(t, http.MethodPost, server.URL+"/api/index/runtime-update", collision, http.StatusConflict)

	missingRelation := []byte(`{
    "schemaVersion":1,"operation":"replace","updateId":"missing-relation",
    "owner":{"definitionId":"mcp.server:catalog","kind":"mcp.server"},
    "ownerFacts":{"kind":"mcp.discovery","implementation":"official-client"},
    "observedAt":"2026-07-14T10:06:00Z","revision":"v3",
    "definitions":[{"id":"tool:orphan","kind":"tool","name":"orphan","fidelity":"resolved"}],
    "relations":[]
  }`)
	assertRejectedRuntimeUpdate(t, server.URL, missingRelation, "")

	missingOwnerFacts := []byte(`{
    "schemaVersion":1,"operation":"replace","updateId":"missing-owner-facts",
    "owner":{"definitionId":"mcp.server:catalog","kind":"mcp.server"},
    "observedAt":"2026-07-14T10:06:00Z","revision":"v3",
    "definitions":[],"relations":[]
  }`)
	assertRejectedRuntimeUpdate(t, server.URL, missingOwnerFacts, "")

	unsafeOwnerFacts := []byte(`{
    "schemaVersion":1,"operation":"replace","updateId":"unsafe-owner-facts",
    "owner":{"definitionId":"mcp.server:catalog","kind":"mcp.server"},
    "ownerFacts":{"kind":"mcp.discovery","implementation":"official-client","server":{"untrusted":true,"name":"unsafe\nname"}},
    "observedAt":"2026-07-14T10:06:00Z","revision":"v3",
    "definitions":[],"relations":[]
  }`)
	assertRejectedRuntimeUpdate(t, server.URL, unsafeOwnerFacts, "")

	failureOwnerFacts := []byte(`{
    "schemaVersion":1,"operation":"failure","updateId":"failure-owner-facts",
    "owner":{"definitionId":"mcp.server:catalog","kind":"mcp.server"},
    "ownerFacts":{"kind":"mcp.discovery","implementation":"official-client"},
    "observedAt":"2026-07-14T10:06:00Z","error":{"phase":"discover","category":"mcp-discovery"}
  }`)
	assertRejectedRuntimeUpdate(t, server.URL, failureOwnerFacts, "")

	secretMetadata := []byte(`{
    "schemaVersion":1,"operation":"replace","updateId":"secret-metadata",
    "owner":{"definitionId":"mcp.server:catalog","kind":"mcp.server"},
    "ownerFacts":{"kind":"mcp.discovery","implementation":"official-client"},
    "observedAt":"2026-07-14T10:07:00Z","revision":"v4",
    "definitions":[{"id":"tool:secret","kind":"tool","name":"secret","fidelity":"resolved",
      "metadata":{"headers":{"Authorization":"runtime-secret-canary"}}}],
    "relations":[{"id":"secret","type":"mcp.server.provides_tool","from":"mcp.server:catalog","to":"tool:secret","fidelity":"resolved"}]
  }`)
	assertRejectedRuntimeUpdate(t, server.URL, secretMetadata, "runtime-secret-canary")

	nestedSecretMetadata := []byte(`{
    "schemaVersion":1,"operation":"replace","updateId":"nested-secret-metadata",
    "owner":{"definitionId":"mcp.server:catalog","kind":"mcp.server"},
    "ownerFacts":{"kind":"mcp.discovery","implementation":"official-client"},
    "observedAt":"2026-07-14T10:08:00Z","revision":"v5",
    "definitions":[{"id":"tool:secret","kind":"tool","name":"secret","fidelity":"resolved",
      "metadata":{"facts":{"kind":"tool","toolName":"secret","mcp":{"serverId":"catalog","remoteName":"secret","exposedName":"secret","provenance":"runtime-discovered"}},
      "mcpDiscovery":{"observedAt":"2026-07-14T10:08:00Z","toolListFingerprint":"list","inputSchemaFingerprint":"input","headers":{"Authorization":"nested-secret-canary"}}}}],
    "relations":[{"id":"secret","type":"mcp.server.provides_tool","from":"mcp.server:catalog","to":"tool:secret","fidelity":"resolved"}]
  }`)
	assertRejectedRuntimeUpdate(t, server.URL, nestedSecretMetadata, "nested-secret-canary")

	missingOwner := []byte(`{
    "schemaVersion":1,"operation":"failure","updateId":"missing-owner",
    "owner":{"definitionId":"mcp.server:missing","kind":"mcp.server"},
    "observedAt":"2026-07-14T10:09:00Z","error":{"phase":"discover","category":"mcp-discovery"}
  }`)
	assertRejectedRuntimeUpdate(t, server.URL, missingOwner, "")

	if err := os.RemoveAll(root); err != nil {
		t.Fatal(err)
	}
	persistenceResponse := assertStatus(t, http.MethodPost, server.URL+"/api/index/runtime-update", body, http.StatusServiceUnavailable)
	responseBody, err := io.ReadAll(persistenceResponse.Body)
	persistenceResponse.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(responseBody, []byte(root)) || !bytes.Contains(responseBody, []byte("unavailable")) {
		t.Fatalf("persistence response was not safe: %s", responseBody)
	}
}

func TestRuntimeUpdateRouteUsesRegisteredSnapshotAsAuthoredBase(t *testing.T) {
	t.Parallel()

	indexStore := store.NewStore()
	devtoolsService := devtools.NewService(
		indexStore,
		inspect.NewService(indexStore, inspect.Dir(t.TempDir())),
	)
	devtoolsService.RegisterIndexSnapshot(context.Background(), store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: t.TempDir()},
		Definitions: []store.ProjectDefinition{
			{ID: "mcp.server:catalog", Kind: "mcp.server", Name: "catalog", Fidelity: "partial"},
		},
	})
	server := httptest.NewServer(New(Options{
		Devtools: devtoolsService, OriginAllowed: func(*http.Request) bool { return true },
	}))
	t.Cleanup(server.Close)

	body := []byte(`{
    "schemaVersion":1,"operation":"failure","updateId":"snapshot-owner-failure",
    "owner":{"definitionId":"mcp.server:catalog","kind":"mcp.server"},
    "observedAt":"2026-07-14T10:00:00Z","error":{"phase":"discover","category":"mcp-discovery"}
  }`)
	assertStatusAndClose(t, http.MethodPost, server.URL+"/api/index/runtime-update", body, http.StatusNoContent)
}

func TestRuntimeUpdateRouteRejectsOversizedBody(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(New(Options{
		Devtools: devtools.NewService(
			store.NewStore(),
			inspect.NewService(store.NewStore(), inspect.Dir(t.TempDir())),
		),
		OriginAllowed: func(*http.Request) bool { return true },
	}))
	t.Cleanup(server.Close)

	body := bytes.Repeat([]byte(" "), maxProjectIndexRuntimeUpdateRequestBytes+1)
	assertStatusAndClose(
		t,
		http.MethodPost,
		server.URL+"/api/index/runtime-update",
		body,
		http.StatusRequestEntityTooLarge,
	)
}

func assertRejectedRuntimeUpdate(t *testing.T, serverURL string, body []byte, secret string) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, serverURL+"/api/index/runtime-update", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("rejected runtime update status = %d, want 400: %s", response.StatusCode, responseBody)
	}
	if secret != "" && bytes.Contains(responseBody, []byte(secret)) {
		t.Fatalf("runtime update rejection exposed secret: %s", responseBody)
	}
}

func assertRuntimeDefinition(t *testing.T, index store.IndexData, id, status string) {
	t.Helper()
	for _, definition := range index.Definitions {
		if definition.ID == id {
			if definition.Status != status {
				t.Fatalf("definition %s status = %q, want %q", id, definition.Status, status)
			}
			return
		}
	}
	t.Fatalf("definition %s not found", id)
}
