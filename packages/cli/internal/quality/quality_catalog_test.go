package quality

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/cli/internal/store"
)

func TestEnrichCatalogLinksExperimentsAndBaselines(t *testing.T) {
	dir := t.TempDir()
	service := NewService(store.NewStore(), Dir(dir))

	experiment := qualityExperimentRecord{
		Tag:       "QualityExperiment",
		ID:        "exp-1",
		QualityID: "q",
		Suite:     qualityExperimentSuite{ID: "suite-1", CaseCount: 1},
		StartedAt: "2026-05-25T10:00:00Z",
		EndedAt:   "2026-05-25T10:01:00Z",
		Status:    "completed",
		Summary: struct {
			Total   int `json:"total"`
			Passed  int `json:"passed"`
			Failed  int `json:"failed"`
			Errored int `json:"errored"`
		}{Total: 1, Passed: 1},
		Variants: []qualityExperimentVariant{{ID: "candidate", TargetID: "writer.prompt", DefinitionFingerprint: "fp-old"}},
		Cases:    []qualityExperimentCase{{CaseID: "case-1", VariantID: "candidate", Status: "passed", TraceID: "trace-1"}},
	}
	if err := writeQualityRecord(Dir(dir), "experiments", experiment.ID, experiment); err != nil {
		t.Fatalf("write experiment: %v", err)
	}
	baseline := qualityBaselineRecord{
		Tag:          "QualityBaseline",
		ID:           "baseline-1",
		QualityID:    "q",
		ExperimentID: "exp-1",
		VariantID:    ptrString("candidate"),
	}
	if err := writeQualityRecord(Dir(dir), "baselines", baseline.ID, baseline); err != nil {
		t.Fatalf("write baseline: %v", err)
	}
	comparison := qualityComparisonRecord{
		Tag:        "QualityComparison",
		ID:         "comparison-1",
		QualityID:  "q",
		ComparedAt: "2026-05-25T10:02:00Z",
		Status:     "completed",
		Baseline:   qualityComparisonSummary{ExperimentID: "exp-1", PassRate: 1},
		Candidate:  qualityComparisonSummary{ExperimentID: "exp-1", PassRate: 1},
	}
	if err := writeQualityRecord(Dir(dir), "comparisons", comparison.ID, comparison); err != nil {
		t.Fatalf("write comparison: %v", err)
	}
	if err := appendQualityJSONLine(filepath.Join(Dir(dir), "feedback", "inbox.jsonl"), qualityFeedbackRecord{
		Tag:          "QualityFeedback",
		ID:           "feedback-1",
		QualityID:    "q",
		ExperimentID: ptrString("exp-1"),
		TraceID:      ptrString("trace-1"),
		Status:       "open",
	}); err != nil {
		t.Fatalf("write feedback: %v", err)
	}
	if err := writeQualityRecord(Dir(dir), "cassettes", "cassette-1", map[string]any{
		"mode": "record",
		"entries": []map[string]any{{
			"id":     "cassette-entry-1",
			"caseId": "case-1",
			"request": map[string]any{
				"kind":     "generation",
				"targetId": "writer.prompt",
			},
			"response":   map[string]any{},
			"recordedAt": "2026-05-25T10:03:00Z",
		}},
	}); err != nil {
		t.Fatalf("write cassette: %v", err)
	}
	if err := writeQualityRecord(Dir(dir), "suites", "suite-2", qualitySuiteRecord{
		Tag:              "QualitySuite",
		SuiteID:          "suite-2",
		Source:           "json",
		LastExperimentID: "exp-2",
		LastRunAt:        "2026-05-25T10:04:00Z",
		LastPassRate:     ptrFloat64(0.5),
		Cases: []qualitySuiteCase{
			{CaseID: "case-2"},
			{CaseID: "case-3"},
		},
	}); err != nil {
		t.Fatalf("write suite: %v", err)
	}

	catalog := service.EnrichCatalog(store.CatalogData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer", Fidelity: "resolved", Fingerprint: "fp-new"},
			{ID: "eval.prompt:writer-eval", Kind: "eval.prompt", Name: "writer eval", Fidelity: "resolved"},
			{ID: "suite:suite-1", Kind: "suite", Name: "suite", Fidelity: "resolved"},
			{ID: "suite:suite-2", Kind: "suite", Name: "suite two", Fidelity: "resolved"},
			{ID: "suite:regression", Kind: "suite", Name: "regression", Fidelity: "resolved"},
		},
		Relations: []store.ProjectRelation{
			{ID: "relation:eval:writer", Type: "eval.targets_prompt", From: "eval.prompt:writer-eval", To: "prompt:writer.prompt", Fidelity: "resolved"},
			{ID: "relation:suite:writer", Type: "suite.includes_eval", From: "suite:regression", To: "eval.prompt:writer-eval", Fidelity: "resolved"},
		},
	})

	prompt := qualityCatalogDefinitionByID(catalog.Definitions, "prompt:writer.prompt")
	if prompt == nil || prompt.Quality == nil {
		t.Fatalf("prompt quality = nil")
	}
	if prompt.Quality.ExperimentCount != 1 || prompt.Quality.BaselineCount != 1 || prompt.Quality.ComparisonCount != 1 || prompt.Quality.FeedbackCount != 1 || prompt.Quality.CassetteCount != 1 {
		t.Fatalf("prompt quality = %+v", prompt.Quality)
	}
	if prompt.Quality.LastRunID != "comparison-1" || prompt.Quality.LastStatus != "completed" {
		t.Fatalf("prompt last run = %+v", prompt.Quality)
	}
	if len(prompt.Quality.TraceIDs) != 1 || prompt.Quality.TraceIDs[0] != "trace-1" {
		t.Fatalf("prompt trace ids = %+v", prompt.Quality.TraceIDs)
	}
	if prompt.Quality.BaselineFingerprint != "fp-old" || prompt.Quality.CurrentFingerprint != "fp-new" || prompt.Quality.ChangedSinceBaseline == nil || !*prompt.Quality.ChangedSinceBaseline {
		t.Fatalf("prompt baseline change = %+v", prompt.Quality)
	}
	if !containsQualityString(prompt.Quality.AffectedEvalIDs, "writer-eval") {
		t.Fatalf("prompt affected evals = %+v", prompt.Quality.AffectedEvalIDs)
	}
	if !containsQualityString(prompt.Quality.AffectedSuiteIDs, "suite-1") || !containsQualityString(prompt.Quality.AffectedSuiteIDs, "regression") {
		t.Fatalf("prompt affected suites = %+v", prompt.Quality.AffectedSuiteIDs)
	}

	suite := qualityCatalogDefinitionByID(catalog.Definitions, "suite:suite-1")
	if suite == nil || suite.Quality == nil || suite.Quality.ExperimentCount != 1 || suite.Quality.BaselineCount != 1 {
		t.Fatalf("suite quality = %+v", suite)
	}
	persistedSuite := qualityCatalogDefinitionByID(catalog.Definitions, "suite:suite-2")
	if persistedSuite == nil || persistedSuite.Quality == nil {
		t.Fatalf("persisted suite quality = nil")
	}
	if persistedSuite.Quality.CaseCount != 2 || len(persistedSuite.Quality.SuiteIDs) != 1 || persistedSuite.Quality.SuiteIDs[0] != "suite-2" {
		t.Fatalf("persisted suite quality = %+v", persistedSuite.Quality)
	}
	if persistedSuite.Quality.LastRunID != "exp-2" || persistedSuite.Quality.LastStatus != "completed" || persistedSuite.Quality.PassRate == nil || *persistedSuite.Quality.PassRate != 0.5 {
		t.Fatalf("persisted suite last quality = %+v", persistedSuite.Quality)
	}
}

func TestEnrichCatalogAddsMissingBaselineLintForQualityTargets(t *testing.T) {
	dir := t.TempDir()
	service := NewService(store.NewStore(), Dir(dir))

	experiment := qualityExperimentRecord{
		Tag:       "QualityExperiment",
		ID:        "exp-without-baseline",
		QualityID: "q",
		Suite:     qualityExperimentSuite{ID: "regression", CaseCount: 1},
		StartedAt: "2026-05-25T10:00:00Z",
		EndedAt:   "2026-05-25T10:01:00Z",
		Status:    "completed",
		Summary: struct {
			Total   int `json:"total"`
			Passed  int `json:"passed"`
			Failed  int `json:"failed"`
			Errored int `json:"errored"`
		}{Total: 1, Passed: 1},
		Variants: []qualityExperimentVariant{{ID: "candidate", TargetID: "writer.prompt"}},
		Cases:    []qualityExperimentCase{{CaseID: "case-1", VariantID: "candidate", Status: "passed", TraceID: "trace-1"}},
	}
	if err := writeQualityRecord(Dir(dir), "experiments", experiment.ID, experiment); err != nil {
		t.Fatalf("write experiment: %v", err)
	}

	catalog := service.EnrichCatalog(store.CatalogData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer", Fidelity: "resolved"},
			{ID: "suite:regression", Kind: "suite", Name: "regression", Fidelity: "resolved"},
		},
	})

	finding := qualityCatalogLintByRuleAndDefinition(catalog.LintFindings, "quality.missing_baseline", "prompt:writer.prompt")
	if finding == nil {
		t.Fatalf("lint findings = %+v, want quality.missing_baseline for prompt", catalog.LintFindings)
	}
	if finding.Category != "quality" || finding.Severity != "info" || finding.Confidence != "high" {
		t.Fatalf("finding metadata = %+v", finding)
	}
	if !containsQualityString(finding.AffectedDefinitionIDs, "prompt:writer.prompt") {
		t.Fatalf("affected definitions = %+v", finding.AffectedDefinitionIDs)
	}
	if len(finding.Evidence) == 0 || finding.Evidence[0].Kind != "quality" {
		t.Fatalf("evidence = %+v, want quality evidence", finding.Evidence)
	}
	if finding.DocsURL != "/docs/reference/crux-core/catalog-lints/quality-missing-baseline" {
		t.Fatalf("docs url = %q", finding.DocsURL)
	}
}

func TestEnrichCatalogAppliesLintConfigToQualityFindings(t *testing.T) {
	dir := t.TempDir()
	service := NewService(store.NewStore(), Dir(dir))
	writeQualityExperimentForDefinition(t, dir, "writer.prompt")

	catalog := service.EnrichCatalog(store.CatalogData{
		Lint: &store.CatalogLintConfig{
			Rules: map[string]store.CatalogLintRuleConfig{
				"quality.missing_baseline": {Enabled: ptrBool(false)},
			},
		},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer", Fidelity: "resolved"},
		},
	})
	if finding := qualityCatalogLintByRuleAndDefinition(catalog.LintFindings, "quality.missing_baseline", "prompt:writer.prompt"); finding != nil {
		t.Fatalf("disabled quality lint finding = %+v, want nil", finding)
	}

	catalog = service.EnrichCatalog(store.CatalogData{
		Lint: &store.CatalogLintConfig{
			Rules: map[string]store.CatalogLintRuleConfig{
				"quality.missing_baseline": {Severity: "warning"},
			},
		},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer.prompt", Kind: "prompt", Name: "writer", Fidelity: "resolved"},
		},
	})
	finding := qualityCatalogLintByRuleAndDefinition(catalog.LintFindings, "quality.missing_baseline", "prompt:writer.prompt")
	if finding == nil {
		t.Fatalf("lint findings = %+v, want quality.missing_baseline", catalog.LintFindings)
	}
	if finding.Severity != "warning" {
		t.Fatalf("finding severity = %q, want warning", finding.Severity)
	}
}

func TestEnrichCatalogAppliesSourceSuppressionsToQualityFindings(t *testing.T) {
	dir := t.TempDir()
	service := NewService(store.NewStore(), Dir(dir))
	writeQualityExperimentForDefinition(t, dir, "writer.prompt")

	sourceFile := filepath.Join(dir, "prompts.ts")
	if err := os.WriteFile(sourceFile, []byte("// crux-lint-disable-next-line quality.missing_baseline -- intentionally baseline later\nexport const writer = prompt({ id: 'writer.prompt' })\n"), 0o644); err != nil {
		t.Fatalf("write source: %v", err)
	}
	unusedDiagnostic := store.CatalogDiagnostic{
		ID:       "catalog.lint_unused_suppression:" + sourceFile + ":1:next-line:quality.missing_baseline",
		Severity: "info",
		Code:     "catalog.lint_unused_suppression",
		Message:  "Crux lint suppression for \"quality.missing_baseline\" did not match any finding.",
		Source:   &store.SourceLoc{File: sourceFile, Line: 1, Column: ptrInt(1)},
	}

	catalog := service.EnrichCatalog(store.CatalogData{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer.prompt",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "resolved",
				Source:   &store.SourceLoc{File: sourceFile, Line: 2, Column: ptrInt(1)},
			},
		},
		Diagnostics: []store.CatalogDiagnostic{unusedDiagnostic},
		Sources:     []store.CatalogSourceFile{{File: sourceFile, Status: "indexed"}},
	})
	if finding := qualityCatalogLintByRuleAndDefinition(catalog.LintFindings, "quality.missing_baseline", "prompt:writer.prompt"); finding != nil {
		t.Fatalf("suppressed quality lint finding = %+v, want nil", finding)
	}
	for _, diagnostic := range catalog.Diagnostics {
		if diagnostic.Code == "catalog.lint_unused_suppression" {
			t.Fatalf("diagnostics = %+v, want matched suppression diagnostic removed", catalog.Diagnostics)
		}
	}
}

func writeQualityExperimentForDefinition(t *testing.T, dir string, targetID string) {
	t.Helper()
	experiment := qualityExperimentRecord{
		Tag:       "QualityExperiment",
		ID:        "exp-without-baseline",
		QualityID: "q",
		StartedAt: "2026-05-25T10:00:00Z",
		EndedAt:   "2026-05-25T10:01:00Z",
		Status:    "completed",
		Summary: struct {
			Total   int `json:"total"`
			Passed  int `json:"passed"`
			Failed  int `json:"failed"`
			Errored int `json:"errored"`
		}{Total: 1, Passed: 1},
		Variants: []qualityExperimentVariant{{ID: "candidate", TargetID: targetID}},
		Cases:    []qualityExperimentCase{{CaseID: "case-1", VariantID: "candidate", Status: "passed", TraceID: "trace-1"}},
	}
	if err := writeQualityRecord(Dir(dir), "experiments", experiment.ID, experiment); err != nil {
		t.Fatalf("write experiment: %v", err)
	}
}

func ptrBool(value bool) *bool {
	return &value
}

func ptrInt(value int) *int {
	return &value
}

func ptrString(value string) *string {
	return &value
}

func ptrFloat64(value float64) *float64 {
	return &value
}

func qualityCatalogDefinitionByID(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}

func qualityCatalogLintByRuleAndDefinition(findings []store.CatalogLintFinding, ruleID string, definitionID string) *store.CatalogLintFinding {
	for i := range findings {
		finding := &findings[i]
		if finding.RuleID == ruleID && containsQualityString(finding.AffectedDefinitionIDs, definitionID) {
			return finding
		}
	}
	return nil
}
