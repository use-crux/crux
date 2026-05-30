package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/cli/internal/api"
)

func sampleComparison() api.QualityComparisonRecord {
	variantBaseline := "baseline-014"
	variantCandidate := "maxIter+dedupe"
	labelB := "baseline-014"
	labelC := "exp-842"
	return api.QualityComparisonRecord{
		ID: "cmp-42",
		Baseline: api.QualityComparisonSummary{
			ExperimentID: "exp-014",
			VariantID:    &variantBaseline,
			Label:        &labelB,
		},
		Candidate: api.QualityComparisonSummary{
			ExperimentID: "exp-842",
			VariantID:    &variantCandidate,
			Label:        &labelC,
		},
		CaseDeltas: []api.QualityComparisonCaseDelta{
			{
				CaseID:    "rag/typed_prompts_definition",
				Baseline:  &api.QualityComparisonCaseSide{TraceID: "run-base-1"},
				Candidate: &api.QualityComparisonCaseSide{TraceID: "run-cand-1"},
			},
			{
				CaseID:    "agent/handoff_timeout",
				Baseline:  &api.QualityComparisonCaseSide{TraceID: "run-base-2"},
				Candidate: &api.QualityComparisonCaseSide{TraceID: "run-cand-2"},
			},
		},
	}
}

// TestComparePromoteEmitsCmd asserts pressing `p` returns a non-nil
// tea.Cmd that calls c.CreateBaseline for the comparison's candidate
// side. Per the workflow, Compare is where promotion decisions happen.
func TestComparePromoteEmitsCmd(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}}, nil)
	if cmd == nil {
		t.Error("pressing `p` on a focused comparison returned nil; expected CreateBaseline cmd")
	}
}

// TestCompareExportEmitsCmd asserts pressing `e` returns a non-nil
// tea.Cmd that writes the focused comparison's case deltas to a CSV
// file under ~/.crux/exports/comparison-{id}.csv.
func TestCompareExportEmitsCmd(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if cmd == nil {
		t.Error("pressing `e` on a focused comparison returned nil; expected export cmd")
	}
}

// TestCompareFilterTogglesOnlyDiffs asserts pressing `f` flips the
// "only show diffs" filter state. The right pane uses this to hide
// unchanged cases; here we just verify the toggle wiring.
func TestCompareFilterTogglesOnlyDiffs(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.loaded = true

	if c.OnlyDiffs() {
		t.Error("OnlyDiffs() should be false by default")
	}
	c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}}, nil)
	if !c.OnlyDiffs() {
		t.Errorf("after `f`, OnlyDiffs() should be true")
	}
	c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}}, nil)
	if c.OnlyDiffs() {
		t.Errorf("after second `f`, OnlyDiffs() should toggle back to false")
	}
}

// TestCompareBreadcrumbShowsBaselineVsCandidate asserts the breadcrumb
// renders `{baseline-label} ⇄ {candidate-label}` as the comparison
// segment (matches screenshot 5: `compare / baseline-014 ⇄ exp-842 /
// rag/typed_prompts_definition`).
func TestCompareBreadcrumbShowsBaselineVsCandidate(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.selectedCase = "rag/typed_prompts_definition"
	c.loaded = true

	path, _ := c.Breadcrumb()
	joined := strings.Join(path, " / ")

	if !strings.Contains(joined, "baseline-014 ⇄ exp-842") {
		t.Errorf("breadcrumb does not show baseline ⇄ candidate labels; got %q", joined)
	}
	if !strings.Contains(joined, "rag/typed_prompts_definition") {
		t.Errorf("breadcrumb does not include the focused case; got %q", joined)
	}
}

// TestCompareCyclePrevNextComparison asserts `^p` / `^n` cycle the
// active comparison through the loaded list. Compare is a deep-link
// screen (no in-screen comparison list), so this chord is the only
// in-TUI way to switch comparisons short of the palette.
func TestCompareCyclePrevNextComparison(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{
		{ID: "cmp-1"}, {ID: "cmp-2"}, {ID: "cmp-3"},
	}
	c.selectedID = "cmp-1"
	c.loaded = true

	c.Update(tea.KeyMsg{Type: tea.KeyCtrlN}, nil)
	if c.selectedID != "cmp-2" {
		t.Errorf("after ^n, selectedID = %q, want %q", c.selectedID, "cmp-2")
	}
	c.Update(tea.KeyMsg{Type: tea.KeyCtrlN}, nil)
	if c.selectedID != "cmp-3" {
		t.Errorf("after second ^n, selectedID = %q, want %q", c.selectedID, "cmp-3")
	}
	// At end: clamp (don't wrap, to avoid surprise navigation).
	c.Update(tea.KeyMsg{Type: tea.KeyCtrlN}, nil)
	if c.selectedID != "cmp-3" {
		t.Errorf("^n at end should clamp; got %q", c.selectedID)
	}
	c.Update(tea.KeyMsg{Type: tea.KeyCtrlP}, nil)
	if c.selectedID != "cmp-2" {
		t.Errorf("after ^p, selectedID = %q, want %q", c.selectedID, "cmp-2")
	}
}

// TestCompareEnterDrillsToCandidateRun asserts ↵ on a focused case
// stages the candidate run + emits a NavigateRequest to Runs.
func TestCompareEnterDrillsToCandidateRun(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.selectedCase = "rag/typed_prompts_definition"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyEnter}, nil)
	if cmd == nil {
		t.Fatal("Enter on focused case returned nil cmd; expected NavigateRequest")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("Enter produced %T, want NavigateRequest", cmd())
	}
	if req.NavID != "runs" {
		t.Errorf("NavigateRequest.NavID = %q, want %q", req.NavID, "runs")
	}
	if req.Kind != "run" {
		t.Errorf("NavigateRequest.Kind = %q, want %q", req.Kind, "run")
	}
	if req.ID != "run-cand-1" {
		t.Errorf("NavigateRequest.ID = %q, want %q (candidate run id)", req.ID, "run-cand-1")
	}
}
