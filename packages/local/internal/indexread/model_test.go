package indexread

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type snapshotSource struct {
	index store.IndexData
	evals []store.EvalRun
	rags  []store.RagEvalRun
	flows []store.FlowRun
}

func (s snapshotSource) Snapshot() (store.IndexData, []store.EvalRun, []store.RagEvalRun, []store.FlowRun) {
	return s.index, s.evals, s.rags, s.flows
}

func TestModelIndexEnrichesRunsQualityFilesSourceMtimeAndSafetyTargets(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "brief.ts")
	if err := os.WriteFile(sourceFile, []byte("prompt"), 0644); err != nil {
		t.Fatal(err)
	}
	mtime := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)
	if err := os.Chtimes(sourceFile, mtime, mtime); err != nil {
		t.Fatal(err)
	}

	qualityDir := t.TempDir()
	writeJSON(t, filepath.Join(qualityDir, "experiments", "exp-1.json"), map[string]any{
		"_tag":      "QualityExperiment",
		"id":        "exp-1",
		"startedAt": "2026-06-10T11:00:00Z",
		"endedAt":   "2026-06-10T11:01:00Z",
		"status":    "completed",
		"summary": map[string]any{
			"total": 2, "passed": 1, "failed": 1,
		},
		"suite": map[string]any{
			"id": "suite-1", "caseCount": 2,
		},
		"variants": []map[string]any{{
			"id":                    "variant-1",
			"targetId":              "brief.prompt",
			"definitionFingerprint": "old-fingerprint",
		}},
		"cases": []map[string]any{{
			"caseId": "case-1", "variantId": "variant-1", "status": "passed", "traceId": "trace-1",
		}},
	})
	writeJSON(t, filepath.Join(qualityDir, "baselines", "baseline-1.json"), map[string]any{
		"_tag":         "QualityBaseline",
		"id":           "baseline-1",
		"experimentId": "exp-1",
		"variantId":    "variant-1",
		"promotedAt":   "2026-06-10T11:02:00Z",
	})

	promptID := "brief.prompt"
	index := store.IndexData{
		Project: &store.ProjectIdentity{Root: root},
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:brief.prompt", Kind: "prompt", Name: "Brief", Fidelity: "resolved", Fingerprint: "new-fingerprint", Source: &store.SourceLoc{File: "brief.ts"}},
			{ID: "eval.prompt:brief-eval", Kind: "eval.prompt", Name: "Brief eval", Fidelity: "resolved", Metadata: json.RawMessage(`{"promptId":"brief.prompt"}`)},
			{ID: "guardrail:toxicity", Kind: "guardrail", Name: "Toxicity", Fidelity: "resolved"},
			{ID: "suite:suite-1", Kind: "suite", Name: "Suite", Fidelity: "resolved"},
		},
		Relations: []store.ProjectRelation{
			{Type: "guardrail.applies_to", From: "guardrail:toxicity", To: "prompt:brief.prompt"},
		},
	}
	model := New(snapshotSource{
		index: index,
		evals: []store.EvalRun{{
			EvalID:     "brief-eval",
			PromptID:   &promptID,
			Status:     "completed",
			StartedAt:  1000,
			TotalCases: 2,
			CompletedCases: []store.EvalCaseData{
				{Passed: true, TraceID: "run-trace-1"},
				{Passed: false, TraceID: "run-trace-2"},
			},
		}},
	}, qualityDir)

	got := model.Index()
	prompt := definitionByID(got.Definitions, "prompt:brief.prompt")
	if prompt == nil || prompt.Quality == nil {
		t.Fatalf("prompt quality missing: %+v", prompt)
	}
	if prompt.Quality.RunCount != 1 || prompt.Quality.ExperimentCount != 1 || prompt.Quality.BaselineCount != 1 {
		t.Fatalf("prompt quality counts = %+v", prompt.Quality)
	}
	if prompt.Quality.ChangedSinceBaseline == nil || !*prompt.Quality.ChangedSinceBaseline {
		t.Fatalf("ChangedSinceBaseline = %+v", prompt.Quality.ChangedSinceBaseline)
	}
	if !contains(prompt.Quality.AffectedEvalIDs, "brief-eval") {
		t.Fatalf("AffectedEvalIDs = %#v, want brief-eval from run pass", prompt.Quality.AffectedEvalIDs)
	}
	if !metadataPathExists(prompt.Metadata, "updated", "sourceMtime") {
		t.Fatalf("prompt metadata missing updated.sourceMtime: %s", string(prompt.Metadata))
	}

	guardrail := definitionByID(got.Definitions, "guardrail:toxicity")
	if guardrail == nil || !metadataPathExists(guardrail.Metadata, "facts", "appliesTo") {
		t.Fatalf("guardrail metadata missing facts.appliesTo: %s", string(guardrail.Metadata))
	}
}

func TestModelIndexReportsQualityLoadFailureAsDiagnostic(t *testing.T) {
	qualityDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(qualityDir, "experiments"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(qualityDir, "experiments", "broken.json"), []byte("{not json"), 0644); err != nil {
		t.Fatal(err)
	}

	model := New(snapshotSource{
		index: store.IndexData{
			Definitions: []store.ProjectDefinition{
				{ID: "prompt:brief.prompt", Kind: "prompt", Name: "Brief", Fidelity: "resolved"},
			},
		},
	}, qualityDir)

	got := model.Index()
	found := false
	for _, diagnostic := range got.Diagnostics {
		if diagnostic.Code == "index.quality_load_failed" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected index.quality_load_failed diagnostic, got %+v", got.Diagnostics)
	}
	if definitionByID(got.Definitions, "prompt:brief.prompt") == nil {
		t.Fatalf("definitions should survive quality load failure")
	}
}

func TestApplyIndexLintPolicyAcceptsScopedExtensionRuleSuppressions(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "workflow.ts")
	if err := os.WriteFile(sourceFile, []byte("// crux-lint-disable-next-line @acme/rules/require-owner -- external owner registry\nworkflow();\n"), 0644); err != nil {
		t.Fatal(err)
	}

	index := store.IndexData{
		Sources: []store.IndexSourceFile{{File: sourceFile, Status: "indexed"}},
		LintFindings: []store.IndexLintFinding{{
			ID:         "lint:@acme/rules/require-owner:workflow",
			Severity:   "warning",
			RuleID:     "@acme/rules/require-owner",
			Category:   "quality",
			Maturity:   "experimental",
			Confidence: "medium",
			Profiles:   []string{"recommended"},
			Title:      "Require owner",
			Message:    "Workflow is missing owner metadata.",
			Source:     &store.SourceLoc{File: sourceFile, Line: 2},
			Evidence:   []store.IndexLintEvidence{},
			Fixes:      []store.IndexLintFix{},
		}},
	}

	applyIndexLintPolicy(&index)

	if len(index.LintFindings) != 0 {
		t.Fatalf("lint findings = %+v, want suppressed extension finding", index.LintFindings)
	}
}

func TestModelIndexEnrichesPromptEvalQualityFromStoreSnapshot(t *testing.T) {
	st := store.NewStore()
	promptID := "brief.prompt"
	st.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:brief.prompt", Kind: "prompt", Name: "brief", Fidelity: "resolved"},
			{ID: "eval.prompt:brief-eval", Kind: "eval.prompt", Name: "brief eval", Fidelity: "resolved", Metadata: json.RawMessage(`{"promptId":"brief.prompt"}`)},
		},
		Relations: []store.ProjectRelation{
			{ID: "rel", Type: "eval.targets_prompt", From: "eval.prompt:brief-eval", To: "prompt:brief.prompt", Fidelity: "resolved"},
		},
	})
	st.EvalStart(store.EvalStartEvent{EvalID: "brief-eval", PromptID: &promptID, StartedAt: 1000, TotalCases: 2})
	st.EvalCase(store.EvalCaseEvent{EvalID: "brief-eval", CaseName: "a", ModelID: "m", Passed: true, TraceID: "trace-a"})
	st.EvalCase(store.EvalCaseEvent{EvalID: "brief-eval", CaseName: "b", ModelID: "m", Passed: false, TraceID: "trace-b"})
	st.EvalEnd(store.EvalEndEvent{EvalID: "brief-eval", DurationMs: 12})

	got := New(st, t.TempDir()).Index()
	prompt := definitionByID(got.Definitions, "prompt:brief.prompt")
	if prompt == nil || prompt.Quality == nil {
		t.Fatalf("prompt quality = nil")
	}
	if prompt.Quality.RunCount != 1 || prompt.Quality.CompletedRunCount != 1 || prompt.Quality.LastRunID != "brief-eval" {
		t.Fatalf("prompt quality = %+v", prompt.Quality)
	}
	if prompt.Quality.PassRate == nil || *prompt.Quality.PassRate != 0.5 {
		t.Fatalf("prompt pass rate = %v, want 0.5", prompt.Quality.PassRate)
	}
	if len(prompt.Quality.TraceIDs) != 2 {
		t.Fatalf("prompt trace ids = %+v, want 2", prompt.Quality.TraceIDs)
	}

	eval := definitionByID(got.Definitions, "eval.prompt:brief-eval")
	if eval == nil || eval.Quality == nil || eval.Quality.RunCount != 1 {
		t.Fatalf("eval quality = %+v", eval)
	}
}

func TestModelIndexEnrichesRagSuiteAndFlowQualityFromStoreSnapshot(t *testing.T) {
	st := store.NewStore()
	st.SetIndexData(store.IndexData{
		Definitions: []store.ProjectDefinition{
			{ID: "suite:rag-suite", Kind: "suite", Name: "rag suite", Fidelity: "resolved"},
			{ID: "eval.rag:rag-eval", Kind: "eval.rag", Name: "rag eval", Fidelity: "resolved"},
			{ID: "flow:writer", Kind: "flow", Name: "writer", Fidelity: "resolved"},
			{ID: "eval.flow:writer", Kind: "eval.flow", Name: "writer eval", Fidelity: "resolved"},
		},
	})
	st.RagEvalStart(store.RagEvalStartEvent{EvalID: "rag-eval", SuiteID: "rag-suite", Timestamp: 2000, CaseCount: 2})
	st.RagEvalCase(store.RagEvalCaseEvent{EvalID: "rag-eval", CaseID: "1", CaseName: "one", Status: "ok"})
	st.RagEvalCase(store.RagEvalCaseEvent{EvalID: "rag-eval", CaseID: "2", CaseName: "two", Status: "failed", FailureTypes: []string{"citation"}})
	st.RagEvalEnd(store.RagEvalEndEvent{EvalID: "rag-eval", Status: "completed"})
	st.FlowStart(store.FlowStartEvent{FlowID: "writer", Name: "writer", StartedAt: 3000, TotalCases: 1})
	st.FlowCase(store.FlowCaseEvent{FlowID: "writer", CaseName: "one", Passed: true})
	st.FlowEnd(store.FlowEndEvent{FlowID: "writer", DurationMs: 10})

	got := New(st, t.TempDir()).Index()
	suite := definitionByID(got.Definitions, "suite:rag-suite")
	if suite == nil || suite.Quality == nil || suite.Quality.RunCount != 1 || suite.Quality.PassRate == nil || *suite.Quality.PassRate != 0.5 {
		t.Fatalf("suite quality = %+v", suite)
	}
	flow := definitionByID(got.Definitions, "flow:writer")
	if flow == nil || flow.Quality == nil || flow.Quality.RunCount != 1 || flow.Quality.PassRate == nil || *flow.Quality.PassRate != 1 {
		t.Fatalf("flow quality = %+v", flow)
	}
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0644); err != nil {
		t.Fatal(err)
	}
}

func definitionByID(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}

func contains(values []string, value string) bool {
	for _, existing := range values {
		if existing == value {
			return true
		}
	}
	return false
}

func metadataPathExists(raw json.RawMessage, first string, second string) bool {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return false
	}
	nested, ok := data[first].(map[string]any)
	if !ok {
		return false
	}
	_, ok = nested[second]
	return ok
}
