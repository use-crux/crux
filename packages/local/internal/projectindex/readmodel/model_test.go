package readmodel

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

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

func definitionByID(definitions []store.ProjectDefinition, id string) *store.ProjectDefinition {
	for index := range definitions {
		if definitions[index].ID == id {
			return &definitions[index]
		}
	}
	return nil
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

	got := New(st).Index()
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

	got := New(st).Index()
	suite := definitionByID(got.Definitions, "suite:rag-suite")
	if suite == nil || suite.Quality == nil || suite.Quality.RunCount != 1 || suite.Quality.PassRate == nil || *suite.Quality.PassRate != 0.5 {
		t.Fatalf("suite quality = %+v", suite)
	}
	flow := definitionByID(got.Definitions, "flow:writer")
	if flow == nil || flow.Quality == nil || flow.Quality.RunCount != 1 || flow.Quality.PassRate == nil || *flow.Quality.PassRate != 1 {
		t.Fatalf("flow quality = %+v", flow)
	}
}
