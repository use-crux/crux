package screens

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func sampleFeedback() api.QualityFeedbackRecord {
	tid := "run-7d2a"
	return api.QualityFeedbackRecord{
		ID:      "fb-1",
		TraceID: &tid,
		Status:  "open",
	}
}

// TestFeedbackEnterDrillsToSourceRun asserts ↵ on a focused feedback
// with a TraceID emits a NavigateRequest to Runs.
func TestFeedbackEnterDrillsToSourceRun(t *testing.T) {
	f := NewFeedback()
	f.items = []api.QualityFeedbackRecord{sampleFeedback()}
	f.selectedID = "fb-1"
	f.loaded = true

	cmd := f.Update(tea.KeyMsg{Type: tea.KeyEnter}, nil)
	if cmd == nil {
		t.Fatal("Enter returned nil cmd; expected NavigateRequest")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("got %T, want NavigateRequest", cmd())
	}
	if req.NavID != "runs" || req.Kind != "run" || req.ID != "run-7d2a" {
		t.Errorf("NavigateRequest = %+v, want {NavID:runs Kind:run ID:run-7d2a}", req)
	}
}

// TestFeedbackXDismissStubEmitsCmd asserts pressing `x` returns a
// non-nil cmd that will call c.SetFeedbackStatus once the backend
// method lands. V1 returns a stub.
func TestFeedbackXDismissStubEmitsCmd(t *testing.T) {
	f := NewFeedback()
	f.items = []api.QualityFeedbackRecord{sampleFeedback()}
	f.selectedID = "fb-1"
	f.loaded = true

	cmd := f.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'x'}}, nil)
	if cmd == nil {
		t.Error("pressing `x` returned nil; expected dismiss stub")
	}
}

// TestFeedbackFCyclesFilter asserts pressing `f` cycles the status
// filter through `open → resolved → dismissed → all → open`.
func TestFeedbackFCyclesFilter(t *testing.T) {
	f := NewFeedback()
	f.items = []api.QualityFeedbackRecord{sampleFeedback()}
	f.loaded = true

	if got := f.StatusFilter(); got != "open" {
		t.Fatalf("initial filter = %q, want %q", got, "open")
	}

	expected := []string{"resolved", "dismissed", "all", "open"}
	for _, want := range expected {
		f.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}}, nil)
		if got := f.StatusFilter(); got != want {
			t.Errorf("after one `f`, filter = %q, want %q", got, want)
		}
	}
}

// TestFeedbackKeybindsUseSuiteNotDataset asserts the legacy
// "save to dataset" label is gone; canonical noun is "suite".
func TestFeedbackKeybindsUseSuiteNotDataset(t *testing.T) {
	f := NewFeedback()
	binds := f.Keybinds()
	for _, b := range binds {
		if b.Label == "save to dataset" {
			t.Errorf("Feedback keybind still says \"save to dataset\"; canonical noun is suite")
		}
	}
}
