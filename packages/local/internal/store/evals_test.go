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

func TestSetIndex(t *testing.T) {
	s := NewStore()
	s.SetIndex(
		[]PromptMeta{{ID: "p1"}},
		[]ContextMeta{{ID: "c1"}},
		[]ToolMeta{{Name: "t1"}},
	)

	cat := s.GetIndex()
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

func TestSetIndex_nil_slices(t *testing.T) {
	s := NewStore()
	s.SetIndex(nil, nil, nil)

	cat := s.GetIndex()
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

func indexDefinitionByID(definitions []ProjectDefinition, id string) *ProjectDefinition {
	for i := range definitions {
		if definitions[i].ID == id {
			return &definitions[i]
		}
	}
	return nil
}
