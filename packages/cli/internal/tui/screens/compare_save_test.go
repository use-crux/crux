package screens

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/cli/internal/api"
)

// TestCompareSPressEmitsLoadCmd asserts pressing `s` on Compare returns
// a non-nil cmd that fetches the suite list (so the picker can render
// it). Same pattern as Runs S7.
func TestCompareSPressEmitsLoadCmd(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.selectedCase = "rag/typed_prompts_definition"
	c.loaded = true

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'s'}}, nil)
	if cmd == nil {
		t.Error("pressing `s` returned nil; expected suite-fetch cmd")
	}
}

// TestCompareSuitesLoadedOpensPicker asserts that when the screen
// receives the suitesForPickerLoadedMsg follow-up, the embedded
// SuitePicker opens with the delivered list.
func TestCompareSuitesLoadedOpensPicker(t *testing.T) {
	c := NewCompare()
	c.items = []api.QualityComparisonRecord{sampleComparison()}
	c.selectedID = "cmp-42"
	c.selectedCase = "rag/typed_prompts_definition"
	c.loaded = true

	suites := []api.QualitySuiteRecord{
		{SuiteID: "rfp-gold", Name: "RFP Gold"},
	}
	c.Update(suitesForPickerLoadedMsg(suites), nil)

	if !c.picker.IsOpen() {
		t.Error("Compare picker did not open after suitesForPickerLoadedMsg")
	}
}

// TestCompareEditingTrueWhenPickerOpen asserts Compare implements
// EditingScreen so the workbench forwards every key to the screen
// while the picker is open.
func TestCompareEditingTrueWhenPickerOpen(t *testing.T) {
	c := NewCompare()
	if c.Editing() {
		t.Error("Editing() should be false by default")
	}
	c.picker.Open([]api.QualitySuiteRecord{{SuiteID: "rfp-gold"}})
	if !c.Editing() {
		t.Error("Editing() should be true when picker is open")
	}
}
