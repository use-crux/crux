package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptTextCompilerEvidenceSurvivesIndexPublication(t *testing.T) {
	t.Parallel()

	raw, err := os.ReadFile(filepath.Join(
		"..", "..", "..", "indexer", "__tests__", "fixtures",
		"prompt-text-editor-conformance-v1.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Semantic struct {
			DefinitionID string                  `json:"definitionId"`
			SourceRef    store.ProjectSourceRef  `json:"sourceRef"`
			Diagnostics  []store.IndexDiagnostic `json:"diagnostics"`
		} `json:"semantic"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}

	state := store.NewStore()
	state.SetIndexData(store.IndexData{
		SchemaVersion: 1,
		Project:       &store.ProjectIdentity{Root: "/repo", Name: "fixture"},
		Definitions: []store.ProjectDefinition{{
			ID: fixture.Semantic.DefinitionID, Kind: "prompt",
			Name: "editor-conformance", Fidelity: "resolved",
			SourceRefs: []store.ProjectSourceRef{fixture.Semantic.SourceRef},
		}},
		Diagnostics: fixture.Semantic.Diagnostics,
	})
	server := httptest.NewServer(newTestHTTPServer(t, state))
	t.Cleanup(server.Close)

	response, err := server.Client().Get(server.URL + "/api/index")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET /api/index status = %d", response.StatusCode)
	}
	var published store.IndexData
	if err := json.NewDecoder(response.Body).Decode(&published); err != nil {
		t.Fatal(err)
	}
	if len(published.Definitions) != 1 ||
		len(published.Definitions[0].SourceRefs) != 1 ||
		len(published.Diagnostics) != 3 {
		t.Fatalf("published PromptText evidence = %#v", published)
	}
	metadata := published.Definitions[0].SourceRefs[0].Metadata
	if !json.Valid(metadata) ||
		!bytes.Contains(metadata, []byte(`"sourceKind":"owner"`)) ||
		!bytes.Contains(metadata, []byte(`"fragmentJoins"`)) {
		t.Fatalf("published PromptText metadata = %s", metadata)
	}
	for _, diagnostic := range published.Diagnostics {
		if diagnostic.Evidence == nil || diagnostic.Evidence.Kind != "prompt-text" {
			t.Fatalf("published diagnostic evidence = %#v", diagnostic.Evidence)
		}
	}
}
