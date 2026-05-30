package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/cli/internal/api"
)

func sampleExperiment() api.QualityExperimentRecord {
	return api.QualityExperimentRecord{
		ID: "exp-843",
		Variants: []api.QualityExperimentVariant{
			{ID: "baseline-014", IsBaseline: true},
			{ID: "maxIter=3"},
			{ID: "dedupe=0.92"},
			{ID: "maxIter+dedupe"},
		},
	}
}

// TestExperimentsHTogglesFocusToDetail asserts `l` moves focus from the
// experiment list to the detail pane, and `j` afterwards cycles the
// variant cursor in the detail's variants × metrics matrix.
func TestExperimentsHTogglesFocusToDetail(t *testing.T) {
	e := NewExperiments()
	e.items = []api.QualityExperimentRecord{sampleExperiment()}
	e.selectedID = "exp-843"
	e.loaded = true

	// Initially focus is on the list; variant cursor is at the baseline.
	if got := e.SelectedVariantID(); got != "baseline-014" {
		t.Fatalf("initial variant = %q, want %q", got, "baseline-014")
	}

	// `l` shifts focus to the detail pane. (`h` shifts back.)
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil)
	// Now `j` should cycle variants in the matrix, not experiments.
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)
	if got := e.SelectedVariantID(); got != "maxIter=3" {
		t.Errorf("after l+j, variant = %q, want %q", got, "maxIter=3")
	}
	// The experiment cursor must NOT have moved.
	if e.selectedID != "exp-843" {
		t.Errorf("experiment cursor moved unexpectedly to %q", e.selectedID)
	}

	// `h` shifts focus back to the list; `j` should leave variant alone.
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'h'}}, nil)
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)
	if got := e.SelectedVariantID(); got != "maxIter=3" {
		t.Errorf("after h+j, variant cursor moved (got %q), should still be %q", got, "maxIter=3")
	}
}

// TestExperimentsPromoteEmitsCmd asserts pressing `p` with a focused
// variant returns a non-nil tea.Cmd — the cmd calls c.CreateBaseline
// with experimentId + variantId. The cmd's actual execution is
// exercised in integration tests; here we verify the keystroke wiring.
func TestExperimentsPromoteEmitsCmd(t *testing.T) {
	e := NewExperiments()
	e.items = []api.QualityExperimentRecord{sampleExperiment()}
	e.selectedID = "exp-843"
	e.loaded = true
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil) // focus detail
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil) // → maxIter=3

	cmd := e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}}, nil)
	if cmd == nil {
		t.Error("pressing `p` with focused variant returned nil; expected promote cmd")
	}
}

// TestExperimentsCompareEmitsCmd asserts pressing `c` with focus on a
// non-baseline variant returns a non-nil tea.Cmd that creates a
// Comparison between this experiment's baseline variant and the
// focused variant. The "instant" form per plan S8 — chord-style
// cross-variant picks are a follow-up.
func TestExperimentsCompareEmitsCmd(t *testing.T) {
	e := NewExperiments()
	e.items = []api.QualityExperimentRecord{sampleExperiment()}
	e.selectedID = "exp-843"
	e.loaded = true
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil) // detail focus
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil) // → maxIter=3 (candidate)

	cmd := e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}}, nil)
	if cmd == nil {
		t.Error("pressing `c` with non-baseline candidate variant returned nil; expected CreateComparison cmd")
	}
}

// TestExperimentsCompareNoopOnBaselineVariant asserts pressing `c`
// while the baseline variant is itself focused returns nil — there's
// nothing to compare against, since the variant IS the baseline.
func TestExperimentsCompareNoopOnBaselineVariant(t *testing.T) {
	e := NewExperiments()
	e.items = []api.QualityExperimentRecord{sampleExperiment()}
	e.selectedID = "exp-843"
	e.loaded = true
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil) // detail focus
	// stays on baseline-014 (first variant, IsBaseline=true)

	cmd := e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'c'}}, nil)
	if cmd != nil {
		t.Errorf("pressing `c` with baseline-variant focus returned non-nil cmd %v; expected no-op", cmd)
	}
}

// TestExperimentsBreadcrumbGainsVariantSegment asserts the breadcrumb
// path includes `variant {id}` segment when focus is in the detail
// pane — so the user can see exactly which row of the matrix they are
// inspecting. See plan S8.
func TestExperimentsBreadcrumbGainsVariantSegment(t *testing.T) {
	e := NewExperiments()
	e.items = []api.QualityExperimentRecord{sampleExperiment()}
	e.selectedID = "exp-843"
	e.loaded = true

	// Focused on the list: no variant segment.
	path, _ := e.Breadcrumb()
	for _, seg := range path {
		if strings.HasPrefix(seg, "variant ") {
			t.Errorf("breadcrumb contains variant segment %q while focus is on the list", seg)
		}
	}

	// Switch focus to detail: variant segment appears.
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil)
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)

	path, _ = e.Breadcrumb()
	foundVariant := false
	for _, seg := range path {
		if strings.HasPrefix(seg, "variant ") && strings.Contains(seg, "maxIter=3") {
			foundVariant = true
		}
	}
	if !foundVariant {
		t.Errorf("breadcrumb missing variant segment after focus shift; got %v", path)
	}
}

// TestExperimentsPromoteNoopFromListFocus asserts pressing `p` while
// focused on the experiment list (not the detail) is a no-op. Promote
// belongs to the variant; the user must focus a variant first.
func TestExperimentsPromoteNoopFromListFocus(t *testing.T) {
	e := NewExperiments()
	e.items = []api.QualityExperimentRecord{sampleExperiment()}
	e.selectedID = "exp-843"
	e.loaded = true
	// focus stays on list (default)

	cmd := e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'p'}}, nil)
	if cmd != nil {
		t.Errorf("pressing `p` while focused on list returned non-nil cmd %v; should be no-op", cmd)
	}
}

// TestExperimentsEnterOnVariantDrillsToRuns asserts `↵` while in the
// detail pane stages the experiment+variant pair and emits a
// NavigateRequest to the Runs screen — that's the per-variant Runs
// drill. See ADR-0051 + plan S8.
func TestExperimentsEnterOnVariantDrillsToRuns(t *testing.T) {
	e := NewExperiments()
	e.items = []api.QualityExperimentRecord{sampleExperiment()}
	e.selectedID = "exp-843"
	e.loaded = true
	// Move focus to detail and advance to "maxIter=3".
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'l'}}, nil)
	e.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)

	cmd := e.Update(tea.KeyMsg{Type: tea.KeyEnter}, nil)
	if cmd == nil {
		t.Fatal("Enter on focused variant returned nil cmd; expected NavigateRequest")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("Enter produced %T, want NavigateRequest", cmd())
	}
	if req.NavID != "runs" {
		t.Errorf("NavigateRequest.NavID = %q, want %q", req.NavID, "runs")
	}
	if req.Kind != "experiment" {
		t.Errorf("NavigateRequest.Kind = %q, want %q (experiment is the primary; variant is staged via the workbench mapping)", req.Kind, "experiment")
	}
	if req.ID != "exp-843" {
		t.Errorf("NavigateRequest.ID = %q, want %q", req.ID, "exp-843")
	}
}
