package overlays

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func sampleSuites() []api.QualitySuiteRecord {
	return []api.QualitySuiteRecord{
		{SuiteID: "rfp-gold", Name: "RFP Gold"},
		{SuiteID: "agent-loops", Name: "Agent Loops"},
		{SuiteID: "core-300", Name: "Core 300"},
	}
}

// TestSuitePickerOpensClosed asserts default state and Open/Close behavior.
func TestSuitePickerOpensClosed(t *testing.T) {
	p := NewSuitePicker()
	if p.IsOpen() {
		t.Fatal("new picker should not be open")
	}
	p.Open(sampleSuites())
	if !p.IsOpen() {
		t.Fatal("Open() did not flip IsOpen")
	}
	p.Close()
	if p.IsOpen() {
		t.Error("Close() did not flip IsOpen back")
	}
}

// TestSuitePickerCursorCycles asserts j/k move the row cursor through
// the suite list (bounded).
func TestSuitePickerCursorCycles(t *testing.T) {
	p := NewSuitePicker()
	p.Open(sampleSuites())

	if got := p.SelectedSuiteID(); got != "rfp-gold" {
		t.Fatalf("initial selected = %q, want %q", got, "rfp-gold")
	}

	p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	if got := p.SelectedSuiteID(); got != "agent-loops" {
		t.Errorf("after j, selected = %q, want %q", got, "agent-loops")
	}

	p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	if got := p.SelectedSuiteID(); got != "core-300" {
		t.Errorf("after second j, selected = %q, want %q", got, "core-300")
	}

	// Bounded at end.
	p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	if got := p.SelectedSuiteID(); got != "core-300" {
		t.Errorf("j at end should clamp; selected = %q", got)
	}

	p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})
	if got := p.SelectedSuiteID(); got != "agent-loops" {
		t.Errorf("after k, selected = %q, want %q", got, "agent-loops")
	}
}

// TestSuitePickerEnterEmitsConfirmation asserts ↵ closes the picker and
// the caller can read the confirmed suite id via Confirmed().
func TestSuitePickerEnterEmitsConfirmation(t *testing.T) {
	p := NewSuitePicker()
	p.Open(sampleSuites())
	p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}})
	p.Update(tea.KeyMsg{Type: tea.KeyEnter})

	if p.IsOpen() {
		t.Errorf("picker should close on Enter")
	}
	id, ok := p.Confirmed()
	if !ok {
		t.Fatal("Confirmed() reports no confirmation; expected one after Enter")
	}
	if id != "agent-loops" {
		t.Errorf("Confirmed() returned %q, want %q", id, "agent-loops")
	}
}

// TestSuitePickerEscCancels asserts esc closes the picker with no
// confirmation.
func TestSuitePickerEscCancels(t *testing.T) {
	p := NewSuitePicker()
	p.Open(sampleSuites())
	p.Update(tea.KeyMsg{Type: tea.KeyEsc})

	if p.IsOpen() {
		t.Errorf("picker should close on esc")
	}
	if _, ok := p.Confirmed(); ok {
		t.Errorf("Confirmed() should report no confirmation after esc")
	}
}

// TestSuitePickerFiltersByQuery asserts typing characters narrows the
// visible list and the cursor stays in-range.
func TestSuitePickerFiltersByQuery(t *testing.T) {
	p := NewSuitePicker()
	p.Open(sampleSuites())

	// Type "loop" — should narrow to just "Agent Loops".
	for _, r := range "loop" {
		p.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{r}})
	}
	if got := p.SelectedSuiteID(); got != "agent-loops" {
		t.Errorf("filter \"loop\" should select \"agent-loops\"; got %q", got)
	}
	if n := p.VisibleCount(); n != 1 {
		t.Errorf("filter \"loop\" should leave 1 visible; got %d", n)
	}
}
