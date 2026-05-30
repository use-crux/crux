package screens

import (
	"testing"

	"github.com/anthropics/crux-cli/internal/api"
	tea "github.com/charmbracelet/bubbletea"
)

func sampleBaseline() api.QualityBaselineRecord {
	return api.QualityBaselineRecord{
		ID:           "baseline-014",
		ExperimentID: "exp-014",
	}
}

// TestBaselinesEnterDrillsToSourceExperiment asserts ↵ on a focused
// baseline emits a NavigateRequest to the Experiments screen with the
// source experiment id staged. Per plan S11.
func TestBaselinesEnterDrillsToSourceExperiment(t *testing.T) {
	b := NewBaselines()
	b.items = []api.QualityBaselineRecord{sampleBaseline()}
	b.selectedID = "baseline-014"
	b.loaded = true

	cmd := b.Update(tea.KeyMsg{Type: tea.KeyEnter}, nil)
	if cmd == nil {
		t.Fatal("Enter returned nil cmd; expected NavigateRequest")
	}
	req, ok := cmd().(NavigateRequest)
	if !ok {
		t.Fatalf("Enter produced %T, want NavigateRequest", cmd())
	}
	if req.NavID != "experiments" {
		t.Errorf("NavigateRequest.NavID = %q, want %q", req.NavID, "experiments")
	}
	if req.Kind != "experiment" || req.ID != "exp-014" {
		t.Errorf("NavigateRequest = {%q, %q}, want {experiment, exp-014}", req.Kind, req.ID)
	}
}

// TestBaselinesExportEmitsCmd asserts `e` returns a non-nil cmd that
// writes the focused baseline to ~/.crux/exports/baseline-{id}.json.
func TestBaselinesExportEmitsCmd(t *testing.T) {
	b := NewBaselines()
	b.items = []api.QualityBaselineRecord{sampleBaseline()}
	b.selectedID = "baseline-014"
	b.loaded = true

	cmd := b.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil; expected export cmd")
	}
}

// TestBaselinesDemoteEmitsCmd asserts uppercase `D` (destructive)
// returns a non-nil cmd that will call c.DemoteBaseline once the
// backend method lands. V1 returns a stub cmd.
func TestBaselinesDemoteEmitsCmd(t *testing.T) {
	b := NewBaselines()
	b.items = []api.QualityBaselineRecord{sampleBaseline()}
	b.selectedID = "baseline-014"
	b.loaded = true

	cmd := b.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'D'}}, nil)
	if cmd == nil {
		t.Error("pressing `D` returned nil; expected demote stub cmd")
	}
}

// TestBaselinesKeybindsAlignContract asserts Baselines' Keybinds()
// match KEYBINDS.md — `R replace` was dropped (promotion lives on
// Compare); `D demote` is the destructive form; `e` exports; `o`
// opens in viewer (not "open experiment" which violated the contract).
func TestBaselinesKeybindsAlignContract(t *testing.T) {
	b := NewBaselines()
	binds := b.Keybinds()
	for _, kb := range binds {
		if kb.Key == "R" && kb.Label == "replace" {
			t.Errorf("Baselines Keybinds still advertises `R replace` — promote lives on Compare")
		}
		if kb.Key == "o" && kb.Label == "open experiment" {
			t.Errorf("Baselines Keybinds labels `o` as \"open experiment\" — should be open-in-viewer")
		}
	}
}
