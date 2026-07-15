package readmodel

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestCatalogExplanationV1MatchesGoldenContract(t *testing.T) {
	index := api.IndexData{
		Definitions: []api.ProjectDefinition{{
			ID: "agent:writer", Kind: "agent", Name: "writer", Fidelity: "resolved", Status: "partial",
			Source: &api.SourceLoc{File: "src/writer.ts", Line: 3},
		}},
		Relations: []api.ProjectRelation{{
			ID: "rel:prompt", Type: "agent.uses_prompt", From: "agent:writer", To: "prompt:brief", Fidelity: "resolved",
		}},
		Diagnostics: []api.IndexDiagnostic{{
			ID: "diag:missing", Severity: "warn", Code: "index.relation_unresolved", Message: "tool target unresolved", RelatedDefinitionIDs: []string{"agent:writer"},
		}},
		LintFindings: []api.IndexLintFinding{{
			ID: "lint:policy", Severity: "warn", RuleID: "agent.missing_policy", Category: "safety", Maturity: "stable", Confidence: "high",
			Profiles: []string{"recommended"}, Title: "Missing policy", Message: "Agent has no policy", Rationale: "Policies bound behavior",
			PrimaryDefinitionID: "agent:writer", Evidence: []api.IndexLintEvidence{}, Fixes: []api.IndexLintFix{},
		}},
		Indexing: &api.ProjectIndexingStatus{
			Status: "degraded", AST: api.IndexIndexingPhaseStatus{Status: "ready"},
			Semantic: api.IndexIndexingSemanticStatus{Status: "degraded"},
			Cache:    &api.IndexIndexingCacheStatus{Status: "hit"}, Error: "semantic evidence partial",
		},
	}
	manifest := &api.CatalogManifestResolutionV1{
		ProjectID: "assistant", ManifestID: "pim_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Resolution: "resolved",
	}
	explanation, found := CatalogExplain(index, "agent:writer", []api.CatalogEvidenceV1{{
		Phase: "semantic", Producer: "@use-crux/indexer/project-indexer@0.5.0", Fidelity: "resolved",
		Source: &api.SourceLoc{File: "src/writer.ts", Line: 3}, Reason: "definition fact from source export writer",
	}}, manifest)
	if !found {
		t.Fatal("catalog explanation was not found")
	}
	got, err := json.MarshalIndent(explanation, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	want, err := os.ReadFile(filepath.Join("testdata", "catalog-explanation-v1.json"))
	if err != nil {
		t.Fatalf("read Catalog explanation golden: %v\nactual:\n%s", err, got)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("Catalog explanation golden mismatch\n--- want\n%s\n--- got\n%s", want, got)
	}
}
