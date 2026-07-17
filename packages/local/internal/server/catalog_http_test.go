package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCatalogHTTPProjectsSafeCurrentReadModel(t *testing.T) {
	root := t.TempDir()
	state := store.NewStore()
	state.SetIndexData(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: root, Name: "display-name"},
		Definitions: []store.ProjectDefinition{{
			ID: "agent:writer", Kind: "agent", Name: "writer", Fidelity: "resolved", Status: "active",
			Source:   &store.SourceLoc{File: filepath.Join(root, "src", "writer.ts"), Line: 3},
			Metadata: json.RawMessage(`{"rawAst":{"secret":"catalog-http-secret"}}`),
		}},
		Relations: []store.ProjectRelation{{
			ID: "rel:prompt", Type: "agent.uses_prompt", From: "agent:writer", To: "prompt:brief", Fidelity: "resolved",
			Metadata: json.RawMessage(`{"secret":"relation-http-secret"}`),
		}},
		Diagnostics: []store.IndexDiagnostic{{
			ID: "diag:missing", Severity: "warn", Code: "index.relation_unresolved", Message: "prompt target unresolved", RelatedDefinitionIDs: []string{"agent:writer"},
		}},
	})
	service := devtools.NewService(state, nil).WithFactStore(nil)
	defer service.Shutdown()
	server := httptest.NewServer(NewHTTPServerWithServices(service, ServerOptions{ProjectRoot: root, InspectDir: t.TempDir()}))
	defer server.Close()

	var explanation api.CatalogExplanationV1
	getCatalogJSON(t, server.URL+"/api/catalog/explain/agent:writer", &explanation)
	if explanation.SchemaVersion != 1 || explanation.Definition.Source == nil || explanation.Definition.Source.File != "src/writer.ts" {
		t.Fatalf("catalog explanation = %+v", explanation)
	}
	if len(explanation.Relations.Unresolved) != 1 {
		t.Fatalf("unresolved relations = %+v", explanation.Relations.Unresolved)
	}

	response, err := http.Get(server.URL + "/api/catalog/explain/agent:writer")
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	serialized := string(body)
	for _, forbidden := range []string{root, "catalog-http-secret", "relation-http-secret", "rawAst"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("Catalog HTTP response leaked %q: %s", forbidden, serialized)
		}
	}

	var status api.CatalogStatusV1
	getCatalogJSON(t, server.URL+"/api/catalog/status", &status)
	if status.Manifests.Count == nil || *status.Manifests.Count != 0 {
		t.Fatalf("manifest status = %+v, want known empty store", status.Manifests)
	}
}

func TestCatalogHTTPReturnsNotFoundForUnknownDefinition(t *testing.T) {
	service := devtools.NewService(store.NewStore(), nil).WithFactStore(nil)
	defer service.Shutdown()
	server := httptest.NewServer(NewHTTPServerWithServices(service, ServerOptions{InspectDir: t.TempDir()}))
	defer server.Close()

	response, err := http.Get(server.URL + "/api/catalog/agent:missing")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
}

func getCatalogJSON(t *testing.T, path string, out any) {
	t.Helper()
	response, err := http.Get(path)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("GET %s = %d: %s", path, response.StatusCode, body)
	}
	if err := json.NewDecoder(response.Body).Decode(out); err != nil {
		t.Fatal(err)
	}
}
