package readmodel

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestModelIndexEnrichesStorageDefinitionsAndWarnings(t *testing.T) {
	index := store.IndexData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "storage.recordStore:records",
				Kind:     "storage.recordStore",
				Name:     "records",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: json.RawMessage(`{"facts":{"kind":"storage.recordStore","backend":"customRecords","capabilities":{"record":{"ttl":false,"filter":"scan","watch":false,"batch":false}}}}`),
			},
			{
				ID:       "storage.vectorStore:vectors",
				Kind:     "storage.vectorStore",
				Name:     "vectors",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: json.RawMessage(`{"facts":{"kind":"storage.vectorStore","backend":"convexVectorStore","capabilities":{"vector":{"dense":true,"sparse":false,"hybrid":false,"fusion":[],"filter":"post","consistency":"strong"}}}}`),
			},
			{
				ID:       "storage.bundle:appStorage",
				Kind:     "storage.bundle",
				Name:     "appStorage",
				Fidelity: "resolved",
				Status:   "active",
				Metadata: json.RawMessage(`{"facts":{"kind":"storage.bundle","records":"records","vectors":"vectors","capabilities":{"asset":{"multipart":false,"signedUrls":false}}}}`),
			},
			{ID: "workspace:docs", Kind: "workspace", Name: "docs", Fidelity: "resolved", Status: "active"},
			{ID: "rag.retriever:docs", Kind: "rag.retriever", Name: "docs", Fidelity: "resolved", Status: "active"},
		},
		Relations: []store.ProjectRelation{
			{ID: "rel:bundle:records", Type: "storage.bundle.uses_record_store", From: "storage.bundle:appStorage", To: "storage.recordStore:records", Fidelity: "resolved"},
			{ID: "rel:bundle:vectors", Type: "storage.bundle.uses_vector_store", From: "storage.bundle:appStorage", To: "storage.vectorStore:vectors", Fidelity: "resolved"},
			{ID: "rel:workspace:storage", Type: "workspace.uses_storage", From: "workspace:docs", To: "storage.bundle:appStorage", Fidelity: "resolved"},
			{ID: "rel:retriever:storage", Type: "rag.retriever.uses_storage", From: "rag.retriever:docs", To: "storage.bundle:appStorage", Fidelity: "resolved"},
		},
	}

	got := New(snapshotSource{index: index}).Index()
	bundle := definitionByID(got.Definitions, "storage.bundle:appStorage")
	if bundle == nil {
		t.Fatal("storage.bundle:appStorage definition missing")
	}
	storage := metadataMapAt(t, bundle.Metadata, "storage")
	components := mapValue(t, storage, "components")
	if components["recordStoreId"] != "storage.recordStore:records" || components["vectorStoreId"] != "storage.vectorStore:vectors" {
		t.Fatalf("components = %+v, want record/vector component ids", components)
	}
	capabilities := mapValue(t, storage, "capabilities")
	vector := mapValue(t, capabilities, "vector")
	if vector["filter"] != "post" {
		t.Fatalf("vector capabilities = %+v, want post-filter vector store surfaced", vector)
	}
	usedBy, ok := storage["usedBy"].([]any)
	if !ok || len(usedBy) != 2 {
		t.Fatalf("usedBy = %+v, want workspace and retriever users", storage["usedBy"])
	}
	warnings, ok := storage["warnings"].([]any)
	if !ok || len(warnings) != 2 {
		t.Fatalf("warnings = %+v, want vector filter and missing asset warnings", storage["warnings"])
	}
	if !hasStorageLint(got.LintFindings, "storage.vector_filter_not_prefiltered", "storage.bundle:appStorage") {
		t.Fatalf("lint findings = %+v, want vector filter warning on appStorage", got.LintFindings)
	}
	if !hasStorageLint(got.LintFindings, "storage.workspace_asset_missing", "workspace:docs") {
		t.Fatalf("lint findings = %+v, want workspace asset warning", got.LintFindings)
	}
	rawStorage, _ := json.Marshal(storage)
	for _, forbidden := range []string{"recordValue", "vectorContents", "assetBody", "signedUrl", "signedUrls", "multipart"} {
		if strings.Contains(string(rawStorage), forbidden) {
			t.Fatalf("storage metadata leaked %q in %s", forbidden, string(rawStorage))
		}
	}
}

func metadataMapAt(t *testing.T, raw json.RawMessage, key string) map[string]any {
	t.Helper()
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatalf("metadata JSON: %v", err)
	}
	return mapValue(t, data, key)
}

func mapValue(t *testing.T, data map[string]any, key string) map[string]any {
	t.Helper()
	nested, ok := data[key].(map[string]any)
	if !ok {
		t.Fatalf("%s = %+v, want object", key, data[key])
	}
	return nested
}

func hasStorageLint(findings []store.IndexLintFinding, ruleID string, primaryDefinitionID string) bool {
	for _, finding := range findings {
		if finding.RuleID == ruleID && finding.PrimaryDefinitionID == primaryDefinitionID {
			return true
		}
	}
	return false
}
