package commands

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func assertCommandGolden(t *testing.T, name string, got string) {
	t.Helper()
	if strings.Contains(got, "\x1b") {
		t.Fatalf("%s golden output contained an ANSI escape:\n%q", name, got)
	}
	path := filepath.Join("testdata", "cli-goldens", name+".golden")
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v\nactual:\n%s", path, err, got)
	}
	if got != string(want) {
		t.Fatalf("%s golden mismatch\n--- want\n%s\n--- got\n%s", name, string(want), got)
	}
}

func TestCLIPlainGoldens(t *testing.T) {
	t.Run("flows", func(t *testing.T) {
		forceAsciiProfile(t)
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printFlows(io, []api.RuntimeFlowRun{
			{Name: "ingest", Status: "success", SessionID: "sess-abcdef0123456789", StartedAt: 1700000000000},
		})

		assertCommandGolden(t, "flows", out.String())
	})

	t.Run("lint", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printLintFindings(io, []api.IndexLintFinding{
			{
				Severity: "error", Title: "Missing description", RuleID: "rule.desc",
				Message: "prompt has no description", PrimaryDefinitionID: "my.prompt",
				Source: &api.SourceLoc{File: "a.eval.ts", Line: 5},
			},
		}, "recommended", false)

		assertCommandGolden(t, "lint", out.String())
	})

	t.Run("stats", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printStats(io, api.Stats{
			TotalExecutions: 3,
			SuccessCount:    2,
			ErrorCount:      1,
			TotalTokens:     1200,
			TotalCost:       0.42,
		})

		assertCommandGolden(t, "stats", out.String())
	})

	t.Run("catalog-list", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printCatalogList(io, api.CatalogListV1{SchemaVersion: 1, Definitions: []api.CatalogListDefinitionV1{
			{ID: "agent:writer", Kind: "agent", Fidelity: "resolved", Status: "active", Source: &api.SourceLoc{File: "src/writer.ts", Line: 3}},
			{ID: "prompt:brief", Kind: "prompt", Fidelity: "inferred", Status: "partial"},
			{ID: "tool:publish", Kind: "tool", Fidelity: "resolved", Status: "active", Source: &api.SourceLoc{File: "src/publish.ts", Line: 9}},
		}})

		assertCommandGolden(t, "catalog-list", out.String())
	})

	t.Run("catalog-show", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printCatalogDefinition(io, api.CatalogDefinitionV1{
			SchemaVersion: 1,
			Definition: api.ProjectDefinition{
				ID: "agent:writer", Kind: "agent", Name: "writer", Fidelity: "resolved", Status: "partial",
				Source:     &api.SourceLoc{File: "src/writer.ts", Line: 3},
				SourceRefs: []api.ProjectSourceRef{{ID: "ref:prompt", Role: "prompt", Source: api.SourceLoc{File: "src/brief.ts", Line: 2}, Fidelity: "resolved"}},
			},
			Relations: api.CatalogRelationsV1{
				Outgoing: []api.ProjectRelation{{ID: "rel:prompt", Type: "agent.uses_prompt", From: "agent:writer", To: "prompt:brief", Fidelity: "resolved"}},
			},
			Lints:           []api.IndexLintFinding{{ID: "lint:policy", Severity: "warn", RuleID: "agent.missing_policy", Title: "Missing policy"}},
			RuntimeActivity: &api.CatalogRuntimeActivityV1{DefinitionID: "agent:writer", RunCount: 2, LastRunID: "run-latest"},
		})

		assertCommandGolden(t, "catalog-show", out.String())
	})

	t.Run("catalog-status", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
		manifestCount := 2

		printCatalogStatus(io, api.CatalogStatusV1{
			SchemaVersion: 1,
			Catalog:       api.CatalogCountsV1{Definitions: 3, Relations: 2, Diagnostics: 1, Lints: 1},
			Indexing: &api.ProjectIndexingStatus{
				Status: "degraded", AST: api.IndexIndexingPhaseStatus{Status: "ready"},
				Semantic: api.IndexIndexingSemanticStatus{Status: "degraded"},
				Cache:    &api.IndexIndexingCacheStatus{Status: "hit", SnapshotAgeMs: 42},
				Error:    "semantic evidence partial",
			},
			Watch: &api.ProjectIndexWatchStatus{State: "ready", LastRun: &api.ProjectIndexWatchRunInfo{
				PlanKind: "full", FallbackUsed: true, FallbackReason: "missing-source-graph",
				ChangedFileCount: 1, AffectedFileCount: 3,
			}},
			Manifests: api.CatalogManifestStatusV1{Count: &manifestCount},
		})

		assertCommandGolden(t, "catalog-status", out.String())
	})

	t.Run("catalog-explain", func(t *testing.T) {
		var out, errBuf bytes.Buffer
		io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})

		printCatalogExplanation(io, api.CatalogExplanationV1{
			SchemaVersion: 1,
			Definition:    api.ProjectDefinition{ID: "agent:writer", Kind: "agent", Fidelity: "resolved", Status: "partial"},
			Evidence: []api.CatalogEvidenceV1{{
				Phase: "semantic", Producer: "@use-crux/indexer/project-indexer@0.5.0", Fidelity: "resolved", Reason: "definition fact from source export writer via prompt, @acme/indexer@1.2.3/custom",
			}},
			Relations:   api.CatalogExplanationRelationsV1{Unresolved: []api.CatalogUnresolvedRelationV1{{ID: "diag:missing", Reason: "child target could not be resolved"}}},
			Diagnostics: []api.IndexDiagnostic{{ID: "diag:missing", Severity: "warn", Code: "index.relation_unresolved", Message: "child target could not be resolved"}},
			Indexing:    api.CatalogExplanationIndexingV1{Cache: "hit", Fallback: "missing-source-graph", PartialReason: "semantic evidence partial"},
		})

		assertCommandGolden(t, "catalog-explain", out.String())
	})
}
