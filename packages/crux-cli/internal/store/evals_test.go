package store

import (
	"encoding/json"
	"testing"
)

func TestEvalStart_basic(t *testing.T) {
	s := NewStore()
	s.EvalStart(EvalStartEvent{
		EvalID:     "e1",
		StartedAt:  1000,
		Models:     []string{"gpt-4", "claude"},
		CaseNames:  []string{"case1", "case2"},
		TotalCases: 4,
	})

	runs := s.GetEvalRuns()
	if len(runs) != 1 {
		t.Fatalf("GetEvalRuns() len = %d, want 1", len(runs))
	}
	if runs[0].EvalID != "e1" {
		t.Errorf("EvalID = %q, want %q", runs[0].EvalID, "e1")
	}
	if runs[0].Status != "running" {
		t.Errorf("Status = %q, want %q", runs[0].Status, "running")
	}
	if len(runs[0].CompletedCases) != 0 {
		t.Errorf("CompletedCases len = %d, want 0", len(runs[0].CompletedCases))
	}
}

func TestEvalCase(t *testing.T) {
	s := NewStore()
	s.EvalStart(EvalStartEvent{
		EvalID:     "e1",
		StartedAt:  1000,
		Models:     []string{"gpt-4"},
		CaseNames:  []string{"case1"},
		TotalCases: 1,
	})

	s.EvalCase(EvalCaseEvent{
		EvalID:     "e1",
		CaseName:   "case1",
		ModelID:    "gpt-4",
		Passed:     true,
		DurationMs: 500,
	})

	run := s.GetEvalRun("e1")
	if run == nil {
		t.Fatal("GetEvalRun(e1) = nil")
	}
	if len(run.CompletedCases) != 1 {
		t.Fatalf("CompletedCases len = %d, want 1", len(run.CompletedCases))
	}
	if !run.CompletedCases[0].Passed {
		t.Error("case should be passed")
	}
}

func TestEvalEnd(t *testing.T) {
	s := NewStore()
	s.EvalStart(EvalStartEvent{
		EvalID:     "e1",
		StartedAt:  1000,
		Models:     []string{"gpt-4"},
		CaseNames:  []string{"case1"},
		TotalCases: 1,
	})
	s.EvalCase(EvalCaseEvent{
		EvalID:     "e1",
		CaseName:   "case1",
		ModelID:    "gpt-4",
		Passed:     true,
		DurationMs: 500,
	})
	s.EvalEnd(EvalEndEvent{
		EvalID:     "e1",
		DurationMs: 600,
		Summary:    json.RawMessage(`{"total":1,"passed":1,"failed":0}`),
	})

	run := s.GetEvalRun("e1")
	if run.Status != "completed" {
		t.Errorf("Status = %q, want %q", run.Status, "completed")
	}
	if run.DurationMs == nil || *run.DurationMs != 600 {
		t.Errorf("DurationMs = %v, want 600", run.DurationMs)
	}
}

func TestEvalStart_eviction(t *testing.T) {
	s := NewStoreWithCapacities(100, 2, 100, 100)

	s.EvalStart(EvalStartEvent{EvalID: "e1", StartedAt: 1000, Models: []string{}, CaseNames: []string{}, TotalCases: 0})
	s.EvalStart(EvalStartEvent{EvalID: "e2", StartedAt: 2000, Models: []string{}, CaseNames: []string{}, TotalCases: 0})
	s.EvalStart(EvalStartEvent{EvalID: "e3", StartedAt: 3000, Models: []string{}, CaseNames: []string{}, TotalCases: 0})

	runs := s.GetEvalRuns()
	if len(runs) != 2 {
		t.Fatalf("after eviction, len = %d, want 2", len(runs))
	}
	if s.GetEvalRun("e1") != nil {
		t.Error("e1 should have been evicted")
	}
}

func TestRagEvalLifecycle(t *testing.T) {
	s := NewStore()
	s.RagEvalStart(RagEvalStartEvent{
		EvalID:       "rag1",
		SuiteID:      "docs",
		CaseCount:    1,
		ConfigLabels: []string{"baseline", "candidate"},
		Timestamp:    1000,
	})
	s.RagEvalCase(RagEvalCaseEvent{
		EvalID:       "rag1",
		CaseID:       "case1",
		CaseName:     "case1",
		Status:       "failed",
		ConfigRole:   "candidate",
		ConfigLabel:  "candidate",
		FailureTypes: []string{"retrieval_miss"},
		DurationMs:   25,
		Metrics:      json.RawMessage(`{"retrieval":{"recall@5":{"status":"failed","score":0}}}`),
	})
	s.RagEvalEnd(RagEvalEndEvent{
		EvalID:  "rag1",
		Status:  "success",
		Summary: json.RawMessage(`{"total":1,"passed":0,"failed":1}`),
	})

	run := s.GetRagEvalRun("rag1")
	if run == nil {
		t.Fatal("GetRagEvalRun(rag1) = nil")
	}
	if run.Status != "completed" {
		t.Errorf("Status = %q, want completed", run.Status)
	}
	if run.SuiteID != "docs" {
		t.Errorf("SuiteID = %q, want docs", run.SuiteID)
	}
	if len(run.CompletedCases) != 1 {
		t.Fatalf("CompletedCases len = %d, want 1", len(run.CompletedCases))
	}
	if run.CompletedCases[0].FailureTypes[0] != "retrieval_miss" {
		t.Errorf("FailureTypes = %+v, want retrieval_miss", run.CompletedCases[0].FailureTypes)
	}
}

func TestRagEvalStartEviction(t *testing.T) {
	s := NewStoreWithCapacities(100, 2, 100, 100)

	s.RagEvalStart(RagEvalStartEvent{EvalID: "r1", Timestamp: 1000})
	s.RagEvalStart(RagEvalStartEvent{EvalID: "r2", Timestamp: 2000})
	s.RagEvalStart(RagEvalStartEvent{EvalID: "r3", Timestamp: 3000})

	runs := s.GetRagEvalRuns()
	if len(runs) != 2 {
		t.Fatalf("after eviction, len = %d, want 2", len(runs))
	}
	if s.GetRagEvalRun("r1") != nil {
		t.Error("r1 should have been evicted")
	}
}

func TestGetEvalBaseline(t *testing.T) {
	s := NewStore()
	promptID := "my-prompt"

	// Running eval — should NOT be returned as baseline.
	s.EvalStart(EvalStartEvent{EvalID: "e1", PromptID: &promptID, StartedAt: 1000, Models: []string{}, CaseNames: []string{}, TotalCases: 0})

	baseline := s.GetEvalBaseline("my-prompt")
	if baseline != nil {
		t.Error("running eval should not be returned as baseline")
	}

	// Complete it.
	s.EvalEnd(EvalEndEvent{EvalID: "e1", DurationMs: 100})

	baseline = s.GetEvalBaseline("my-prompt")
	if baseline == nil {
		t.Fatal("completed eval should be returned as baseline")
	}
	if baseline.EvalID != "e1" {
		t.Errorf("baseline EvalID = %q, want %q", baseline.EvalID, "e1")
	}
}

func TestGetEvalBaseline_not_found(t *testing.T) {
	s := NewStore()
	if s.GetEvalBaseline("nonexistent") != nil {
		t.Error("should return nil for unknown prompt")
	}
}

func TestEvalCase_nonexistent_run(t *testing.T) {
	s := NewStore()
	// Should not panic.
	s.EvalCase(EvalCaseEvent{EvalID: "nonexistent", CaseName: "c1", ModelID: "m1", DurationMs: 100})
}

func TestSetCatalog(t *testing.T) {
	s := NewStore()
	s.SetCatalog(
		[]PromptMeta{{ID: "p1"}},
		[]ContextMeta{{ID: "c1"}},
		[]ToolMeta{{Name: "t1"}},
	)

	cat := s.GetCatalog()
	if len(cat.Prompts) != 1 || cat.Prompts[0].ID != "p1" {
		t.Errorf("Prompts = %+v, want [{ID:p1}]", cat.Prompts)
	}
	if len(cat.Contexts) != 1 || cat.Contexts[0].ID != "c1" {
		t.Errorf("Contexts = %+v, want [{ID:c1}]", cat.Contexts)
	}
	if len(cat.Tools) != 1 || cat.Tools[0].Name != "t1" {
		t.Errorf("Tools = %+v, want [{Name:t1}]", cat.Tools)
	}
}

func TestSetCatalog_nil_slices(t *testing.T) {
	s := NewStore()
	s.SetCatalog(nil, nil, nil)

	cat := s.GetCatalog()
	if cat.Prompts == nil {
		t.Error("Prompts should be empty slice, not nil")
	}
	if cat.Contexts == nil {
		t.Error("Contexts should be empty slice, not nil")
	}
	if cat.Tools == nil {
		t.Error("Tools should be empty slice, not nil")
	}
}

func TestGetCatalog_enrichesPromptEvalQuality(t *testing.T) {
	s := NewStore()
	promptID := "brief.prompt"
	s.SetCatalogData(CatalogData{
		Definitions: []ProjectDefinition{
			{ID: "prompt:brief.prompt", Kind: "prompt", Name: "brief", Fidelity: "resolved"},
			{ID: "eval.prompt:brief-eval", Kind: "eval.prompt", Name: "brief eval", Fidelity: "resolved", Metadata: json.RawMessage(`{"promptId":"brief.prompt"}`)},
		},
		Relations: []ProjectRelation{
			{ID: "rel", Type: "eval.targets_prompt", From: "eval.prompt:brief-eval", To: "prompt:brief.prompt", Fidelity: "resolved"},
		},
	})
	s.EvalStart(EvalStartEvent{EvalID: "brief-eval", PromptID: &promptID, StartedAt: 1000, TotalCases: 2})
	s.EvalCase(EvalCaseEvent{EvalID: "brief-eval", CaseName: "a", ModelID: "m", Passed: true, TraceID: "trace-a"})
	s.EvalCase(EvalCaseEvent{EvalID: "brief-eval", CaseName: "b", ModelID: "m", Passed: false, TraceID: "trace-b"})
	s.EvalEnd(EvalEndEvent{EvalID: "brief-eval", DurationMs: 12})

	cat := s.GetCatalog()
	prompt := catalogDefinitionByID(cat.Definitions, "prompt:brief.prompt")
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

	eval := catalogDefinitionByID(cat.Definitions, "eval.prompt:brief-eval")
	if eval == nil || eval.Quality == nil || eval.Quality.RunCount != 1 {
		t.Fatalf("eval quality = %+v", eval)
	}
}

func TestGetCatalog_enrichesRagSuiteAndFlowQuality(t *testing.T) {
	s := NewStore()
	s.SetCatalogData(CatalogData{
		Definitions: []ProjectDefinition{
			{ID: "suite:rag-suite", Kind: "suite", Name: "rag suite", Fidelity: "resolved"},
			{ID: "eval.rag:rag-eval", Kind: "eval.rag", Name: "rag eval", Fidelity: "resolved"},
			{ID: "flow:writer", Kind: "flow", Name: "writer", Fidelity: "resolved"},
			{ID: "eval.flow:writer", Kind: "eval.flow", Name: "writer eval", Fidelity: "resolved"},
		},
	})
	s.RagEvalStart(RagEvalStartEvent{EvalID: "rag-eval", SuiteID: "rag-suite", Timestamp: 2000, CaseCount: 2})
	s.RagEvalCase(RagEvalCaseEvent{EvalID: "rag-eval", CaseID: "1", CaseName: "one", Status: "ok"})
	s.RagEvalCase(RagEvalCaseEvent{EvalID: "rag-eval", CaseID: "2", CaseName: "two", Status: "failed", FailureTypes: []string{"citation"}})
	s.RagEvalEnd(RagEvalEndEvent{EvalID: "rag-eval", Status: "completed"})
	s.FlowStart(FlowStartEvent{FlowID: "writer", Name: "writer", StartedAt: 3000, TotalCases: 1})
	s.FlowCase(FlowCaseEvent{FlowID: "writer", CaseName: "one", Passed: true})
	s.FlowEnd(FlowEndEvent{FlowID: "writer", DurationMs: 10})

	cat := s.GetCatalog()
	suite := catalogDefinitionByID(cat.Definitions, "suite:rag-suite")
	if suite == nil || suite.Quality == nil || suite.Quality.RunCount != 1 || suite.Quality.PassRate == nil || *suite.Quality.PassRate != 0.5 {
		t.Fatalf("suite quality = %+v", suite)
	}
	flow := catalogDefinitionByID(cat.Definitions, "flow:writer")
	if flow == nil || flow.Quality == nil || flow.Quality.RunCount != 1 || flow.Quality.PassRate == nil || *flow.Quality.PassRate != 1 {
		t.Fatalf("flow quality = %+v", flow)
	}
}

func catalogDefinitionByID(definitions []ProjectDefinition, id string) *ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}
