package screens

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// TestFeedbackSPressEmitsLoadCmd asserts pressing `s` on Feedback
// returns a non-nil cmd that fetches suites for the picker.
func TestFeedbackSPressEmitsLoadCmd(t *testing.T) {
	f := NewFeedback()
	f.items = []api.QualityFeedbackRecord{sampleFeedback()}
	f.selectedID = "fb-1"
	f.loaded = true

	cmd := f.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'s'}}, nil)
	if cmd == nil {
		t.Error("pressing `s` returned nil; expected suite-fetch cmd")
	}
}

// TestFeedbackSuitesLoadedOpensPicker asserts the suites-loaded
// follow-up opens the embedded SuitePicker.
func TestFeedbackSuitesLoadedOpensPicker(t *testing.T) {
	f := NewFeedback()
	f.items = []api.QualityFeedbackRecord{sampleFeedback()}
	f.selectedID = "fb-1"
	f.loaded = true

	f.Update(suitesForPickerLoadedMsg([]api.QualitySuiteRecord{
		{SuiteID: "rfp-gold"},
	}), nil)

	if !f.picker.IsOpen() {
		t.Error("picker did not open after suitesForPickerLoadedMsg")
	}
}

// TestFeedbackEditingTrueWhenPickerOpen asserts the EditingScreen
// hint flips to true when the picker captures the keystream.
func TestFeedbackEditingTrueWhenPickerOpen(t *testing.T) {
	f := NewFeedback()
	if f.Editing() {
		t.Error("Editing() should be false by default")
	}
	f.picker.Open([]api.QualitySuiteRecord{{SuiteID: "rfp-gold"}})
	if !f.Editing() {
		t.Error("Editing() should be true when picker is open")
	}
}
