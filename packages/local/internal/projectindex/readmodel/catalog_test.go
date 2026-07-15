package readmodel

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/projectindex/model"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestCatalogListIncludesEveryKindInStableOrder(t *testing.T) {
	index := api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "tool:search", Kind: "tool", Fidelity: "resolved", Status: "active"},
		{ID: "agent:writer", Kind: "agent", Fidelity: "inferred", Status: "partial"},
		{ID: "prompt:brief", Kind: "prompt", Fidelity: "resolved", Status: "active"},
		{ID: "agent:planner", Kind: "agent", Fidelity: "resolved", Status: "active"},
	}}

	got := CatalogList(index, "")
	want := []string{"agent:planner", "agent:writer", "prompt:brief", "tool:search"}
	ids := make([]string, 0, len(got.Definitions))
	for _, definition := range got.Definitions {
		ids = append(ids, definition.ID)
	}
	if !reflect.DeepEqual(ids, want) {
		t.Fatalf("catalog IDs = %v, want %v", ids, want)
	}
	if filtered := CatalogList(index, "agent"); len(filtered.Definitions) != 2 {
		t.Fatalf("agent definitions = %d, want 2", len(filtered.Definitions))
	}
}

func TestCatalogShowProjectsSafeRelatedEvidence(t *testing.T) {
	index := catalogFixture()
	activity := &api.CatalogRuntimeActivityV1{
		DefinitionID: "agent:writer",
		RunCount:     2,
		LastRunID:    "run-latest",
	}

	got, found := CatalogShow(index, "agent:writer", activity, []api.CatalogEvidenceV1{{
		Phase: "semantic", Producer: "@use-crux/indexer/project-indexer", Fidelity: "resolved", Reason: "semantic definition fact",
	}})
	if !found {
		t.Fatal("catalog definition was not found")
	}
	if len(got.Relations.Incoming) != 1 || len(got.Relations.Outgoing) != 1 {
		t.Fatalf("relations = %+v, want one incoming and one outgoing", got.Relations)
	}
	if len(got.Diagnostics) != 1 || len(got.Lints) != 1 {
		t.Fatalf("health evidence = diagnostics:%d lints:%d, want 1/1", len(got.Diagnostics), len(got.Lints))
	}
	if got.RuntimeActivity == nil || got.RuntimeActivity.RunCount != 2 {
		t.Fatalf("runtime activity = %+v, want two runs", got.RuntimeActivity)
	}
}

func TestCatalogExplainUsesOnlyCompilerOwnedEvidence(t *testing.T) {
	index := catalogFixture()
	index.Indexing = &api.ProjectIndexingStatus{
		Semantic: api.IndexIndexingSemanticStatus{Status: "ready", Backend: "typescript"},
	}
	evidence := []api.CatalogEvidenceV1{
		{Phase: "semantic", Producer: "@use-crux/indexer/project-indexer", Fidelity: "resolved", Reason: "semantic definition fact"},
		{Phase: "ast", Producer: "@use-crux/indexer/static-compiler", Fidelity: "inferred", Reason: "static definition fact"},
	}

	got, found := CatalogExplain(index, "agent:writer", evidence, nil)
	if !found {
		t.Fatal("catalog explanation was not found")
	}
	if got.SchemaVersion != 1 || got.Definition.ID != "agent:writer" {
		t.Fatalf("explanation identity = %+v", got)
	}
	if got.Evidence[0].Phase != "ast" || got.Evidence[1].Phase != "semantic" {
		t.Fatalf("evidence order = %+v, want ast then semantic", got.Evidence)
	}
	if len(got.Relations.Unresolved) != 1 || got.Relations.Unresolved[0].ID != "diag:missing-child" {
		t.Fatalf("unresolved relations = %+v", got.Relations.Unresolved)
	}
	if got.Indexing.Backend != "typescript" {
		t.Fatalf("explanation backend = %q, want typescript", got.Indexing.Backend)
	}
}

func TestCatalogStatusPreservesUnknownsAndWatchFallback(t *testing.T) {
	index := catalogFixture()
	index.Indexing = &api.ProjectIndexingStatus{
		Status: "degraded",
		AST:    api.IndexIndexingPhaseStatus{Status: "ready"},
		Semantic: api.IndexIndexingSemanticStatus{
			Status: "degraded", Backend: "native",
		},
		Cache: &api.IndexIndexingCacheStatus{Status: "hit", SnapshotAgeMs: 42},
		Error: "semantic evidence partial",
	}
	watch := api.ProjectIndexWatchStatus{State: "ready", LastRun: &api.ProjectIndexWatchRunInfo{
		PlanKind: "full", FallbackUsed: true, FallbackReason: "missing-source-graph",
		ChangedFileCount: 1, AffectedFileCount: 3,
	}}

	manifestCount := 2
	got := CatalogStatus(index, watch, &manifestCount, nil)
	if got.Manifests.Count == nil || *got.Manifests.Count != 2 || got.Manifests.Current != nil {
		t.Fatalf("manifest status = %+v, want count with unknown current identity", got.Manifests)
	}
	if got.Indexing == nil || got.Indexing.Cache == nil || got.Watch == nil || !got.Watch.LastRun.FallbackUsed {
		t.Fatalf("indexing status lost evidence: %+v", got)
	}
	if got.Semantic == nil || got.Semantic.Backend != "native" {
		t.Fatalf("semantic status = %+v, want selected native backend", got.Semantic)
	}
}

func TestCatalogEvidenceProjectsDurableFactsWithoutAbsolutePaths(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "src", "writer.ts")
	payload, err := json.Marshal(api.ProjectDefinition{
		ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "resolved",
		Source: &api.SourceLoc{File: source, Line: 7},
	})
	if err != nil {
		t.Fatal(err)
	}
	facts := []model.IndexFactEnvelope{{
		FactID: "definitions:prompt:writer", Kind: "definitions", Phase: model.PhaseAST,
		Producer: model.IndexFactProducer{Name: "@use-crux/indexer/static-compiler", Version: "0.5.0"},
		Fidelity: "inferred", Provenance: model.IndexFactProvenance{
			Kind: "source", File: source, ExportName: "writer",
			Extractors: []model.IndexFactExtractorProvenance{
				{Name: "prompt"},
				{Name: "custom", Extension: &model.IndexFactProducer{Name: "@acme/indexer", Version: "1.2.3"}},
			},
		},
		Fact: payload,
	}}

	got := CatalogEvidence(root, facts)
	if len(got) != 1 || got[0].Source == nil || got[0].Source.File != "src/writer.ts" {
		t.Fatalf("catalog evidence = %+v, want one repository-relative source", got)
	}
	if got[0].Producer != "@use-crux/indexer/static-compiler@0.5.0" {
		t.Fatalf("producer = %q", got[0].Producer)
	}
	if got[0].Reason != "definition fact from source export writer via prompt, @acme/indexer@1.2.3/custom" {
		t.Fatalf("reason = %q", got[0].Reason)
	}
}

func TestCatalogEvidenceProjectsExtractorAttributedRelatedFacts(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "src", "writer.ts")
	extractors := []model.IndexFactExtractorProvenance{{
		Name: "writer.extractor",
		Extension: &model.IndexFactProducer{
			Name: "@scope/writer-extension", Version: "1.2.3",
		},
	}}
	producer := model.IndexFactProducer{Name: "@use-crux/indexer/static-compiler", Version: "0.5.0"}
	fact := func(factID, kind string, value any) model.IndexFactEnvelope {
		payload, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return model.IndexFactEnvelope{
			FactID: factID, Kind: kind, Phase: model.PhaseAST, Producer: producer,
			Fidelity: "resolved", Provenance: model.IndexFactProvenance{
				Kind: "source", File: source, Extractors: extractors,
			},
			Fact: payload,
		}
	}

	facts := []model.IndexFactEnvelope{
		fact("relations:writer-brand", "relations", api.ProjectRelation{
			ID: "writer-brand", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brand",
			Fidelity: "resolved", Source: &api.SourceLoc{File: source, Line: 8},
		}),
		fact("sourceRefs:writer-schema", "sourceRefs", model.IndexSourceRefFact{
			DefinitionID: "prompt:writer",
			Ref:          store.ProjectSourceRef{ID: "writer-schema", Role: "schema", Fidelity: "resolved", Source: store.SourceLoc{File: source, Line: 9}},
		}),
		fact("diagnostics:writer", "diagnostics", api.IndexDiagnostic{
			ID: "writer", Severity: "warning", Code: "extension.writer_partial", Message: "partial",
			Source: &api.SourceLoc{File: source, Line: 10}, RelatedDefinitionIDs: []string{"prompt:writer"},
		}),
	}

	got := CatalogEvidence(root, facts)
	if len(got) != 3 {
		t.Fatalf("catalog evidence = %+v, want three attributed related facts", got)
	}
	wantReasons := []string{
		"diagnostic fact from source via @scope/writer-extension@1.2.3/writer.extractor",
		"relation fact from source via @scope/writer-extension@1.2.3/writer.extractor",
		"sourceRef fact from source via @scope/writer-extension@1.2.3/writer.extractor",
	}
	for index, want := range wantReasons {
		if got[index].Reason != want || got[index].Source == nil || got[index].Source.File != "src/writer.ts" {
			t.Fatalf("catalog evidence[%d] = %+v, want reason %q and repository-relative source", index, got[index], want)
		}
	}
}

func TestCatalogExplanationSanitizesCurrentReadModelPaths(t *testing.T) {
	root := t.TempDir()
	index := catalogFixture()
	index.Project = &api.ProjectIdentity{Root: root}
	index.Definitions[1].Source = &api.SourceLoc{File: filepath.Join(root, "src", "writer.ts"), Line: 3}
	index.Definitions[1].SourceRefs = []api.ProjectSourceRef{{
		ID: "ref:model", Role: "model", Source: api.SourceLoc{File: filepath.Join(root, "src", "model.ts"), Line: 2}, Fidelity: "resolved",
	}}
	index.Relations[0].Source = &api.SourceLoc{File: filepath.Join(root, "src", "writer.ts"), Line: 4}
	index.Diagnostics[0].Source = &api.SourceLoc{File: filepath.Join(root, "src", "writer.ts"), Line: 5}
	index.LintFindings[0].Source = &api.SourceLoc{File: filepath.Join(root, "src", "writer.ts"), Line: 6}

	got, found := CatalogExplain(index, "agent:writer", nil, nil)
	if !found {
		t.Fatal("catalog explanation was not found")
	}
	if got.Definition.Source == nil || got.Definition.Source.File != "src/writer.ts" {
		t.Fatalf("definition source = %+v", got.Definition.Source)
	}
	if got.Definition.SourceRefs[0].Source.File != "src/model.ts" || got.Relations.Outgoing[0].Source.File != "src/writer.ts" {
		t.Fatalf("related sources were not sanitized: %+v", got)
	}
}

func TestCatalogExplanationDropsOpaqueCompilerMetadata(t *testing.T) {
	root := t.TempDir()
	index := catalogFixture()
	index.Project = &api.ProjectIdentity{Root: root}
	index.Definitions[1].Metadata = json.RawMessage(`{"rawAst":{"secret":"catalog-secret"}}`)
	index.Relations[0].Metadata = json.RawMessage(`{"secret":"relation-secret"}`)

	explanation, found := CatalogExplain(index, "agent:writer", nil, nil)
	if !found {
		t.Fatal("catalog explanation was not found")
	}
	encoded, err := json.Marshal(explanation)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "catalog-secret") || strings.Contains(string(encoded), "relation-secret") || strings.Contains(string(encoded), "rawAst") {
		t.Fatalf("unsafe compiler metadata leaked: %s", encoded)
	}
}

func catalogFixture() api.IndexData {
	return api.IndexData{
		Definitions: []api.ProjectDefinition{
			{ID: "prompt:brief", Kind: "prompt", Name: "brief", Fidelity: "resolved", Status: "active"},
			{ID: "agent:writer", Kind: "agent", Name: "writer", Fidelity: "resolved", Status: "partial"},
			{ID: "tool:publish", Kind: "tool", Name: "publish", Fidelity: "resolved", Status: "active"},
		},
		Relations: []api.ProjectRelation{
			{ID: "rel:prompt", Type: "agent.uses_prompt", From: "agent:writer", To: "prompt:brief", Fidelity: "resolved"},
			{ID: "rel:tool", Type: "agent.uses_tool", From: "tool:publish", To: "agent:writer", Fidelity: "resolved"},
		},
		Diagnostics: []api.IndexDiagnostic{{
			ID: "diag:missing-child", Severity: "warn", Code: "index.relation_unresolved", Message: "child target could not be resolved", RelatedDefinitionIDs: []string{"agent:writer"},
		}},
		LintFindings: []api.IndexLintFinding{{
			ID: "lint:writer", RuleID: "agent.missing_policy", Severity: "warn", PrimaryDefinitionID: "agent:writer",
		}},
	}
}
