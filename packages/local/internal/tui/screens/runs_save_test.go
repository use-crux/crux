package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// TestRunsSPressEmitsLoadCmd asserts that pressing `s` on the Runs
// screen returns a non-nil tea.Cmd. The cmd fetches the suite list
// (so the picker can render it) and emits a follow-up message that
// opens the picker. We don't drive the cmd here — the next test does
// that synthetically via the message handler.
func TestRunsSPressEmitsLoadCmd(t *testing.T) {
	r := NewRuns()
	r.loaded = true
	r.selRun = "8af2f1c"
	r.detail = &api.QualityRunDetailRecord{
		Run: api.QualityRunRecord{TraceID: "8af2f1c"},
	}

	cmd := r.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'s'}}, nil)
	if cmd == nil {
		t.Fatal("`s` on Runs returned nil cmd — expected a suite-fetch cmd to seed the picker")
	}
}

// TestRunsSuitesLoadedOpensPicker asserts that when the screen receives
// the suitesForPickerLoadedMsg follow-up, the embedded SuitePicker
// opens with the delivered suite list.
func TestRunsSuitesLoadedOpensPicker(t *testing.T) {
	r := NewRuns()
	r.loaded = true
	r.selRun = "8af2f1c"
	r.detail = &api.QualityRunDetailRecord{
		Run: api.QualityRunRecord{TraceID: "8af2f1c"},
	}

	suites := []api.QualitySuiteRecord{
		{SuiteID: "rfp-gold", Name: "RFP Gold"},
		{SuiteID: "agent-loops", Name: "Agent Loops"},
	}
	r.Update(suitesForPickerLoadedMsg(suites), nil)

	if !r.picker.IsOpen() {
		t.Error("suite picker did not open after suitesForPickerLoadedMsg")
	}
	if got := r.picker.SelectedSuiteID(); got != "rfp-gold" {
		t.Errorf("picker default selection = %q, want %q", got, "rfp-gold")
	}
}

// TestRunsEditingTrueWhenPickerOpen asserts the Runs screen implements
// EditingScreen and reports true when the picker is open — that's how
// the workbench knows to forward every keystroke straight to the
// screen so the picker captures input cleanly.
func TestRunsEditingTrueWhenPickerOpen(t *testing.T) {
	r := NewRuns()
	if r.Editing() {
		t.Error("Editing() should be false by default")
	}
	r.picker.Open([]api.QualitySuiteRecord{
		{SuiteID: "rfp-gold"},
	})
	if !r.Editing() {
		t.Error("Editing() should be true when SuitePicker is open")
	}
}

// TestRunsViewRendersPickerWhenOpen asserts that when the picker is
// open the screen's View output contains the picker's modal — title
// "save as case → suite" — composited over the body. Without this
// the picker would be invisible.
func TestRunsViewRendersPickerWhenOpen(t *testing.T) {
	r := NewRuns()
	r.loaded = true
	r.selRun = "8af2f1c"
	r.detail = &api.QualityRunDetailRecord{
		Run: api.QualityRunRecord{TraceID: "8af2f1c"},
	}
	r.picker.Open([]api.QualitySuiteRecord{
		{SuiteID: "rfp-gold", Name: "RFP Gold"},
	})

	out := r.View(Size{Width: 160, Height: 40})
	if !strings.Contains(out, "save as case") {
		t.Errorf("Runs.View() did not render the open picker modal (looking for \"save as case\")")
	}
}
