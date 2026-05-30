package screens

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/cli/internal/api"
)

// TestRunsExportEmitsCmd asserts pressing `e` with a selected run
// returns a non-nil tea.Cmd — the cmd writes the run's JSON to
// ~/.crux/exports/run-{id}.json and emits an `exportSavedMsg`. The
// actual file IO is exercised via the cmd; the screen-level behavior
// under test is "produces a cmd."
func TestRunsExportEmitsCmd(t *testing.T) {
	r := NewRuns()
	r.loaded = true
	r.selRun = "8af2f1c"
	r.detail = &api.QualityRunDetailRecord{
		Run: api.QualityRunRecord{TraceID: "8af2f1c"},
	}

	cmd := r.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil cmd; expected export emitter")
	}
}

// TestRunsExportWithoutSelectionIsNoop asserts pressing `e` with no
// run loaded does nothing (returns nil) so the user doesn't see a
// surprise file appear.
func TestRunsExportWithoutSelectionIsNoop(t *testing.T) {
	r := NewRuns()
	r.loaded = true
	// No detail, no selRun.

	cmd := r.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if cmd != nil {
		t.Errorf("pressing `e` without a run returned non-nil cmd %v", cmd)
	}
}
