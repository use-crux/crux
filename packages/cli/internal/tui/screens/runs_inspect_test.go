package screens

import (
	"encoding/json"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/cli/internal/api"
)

// TestRunsInspectKeyIsI asserts the in-TUI raw-inspect overlay opens on
// `i` (not `o`). Per the KEYBINDS.md contract, `o` is reserved for
// "open in external viewer"; raw-inspect drops to Layer-3 `i`. See S7.
func TestRunsInspectKeyIsI(t *testing.T) {
	r := buildRunWithSpan()

	// `i` should emit an InspectRequest via the returned tea.Cmd.
	cmd := r.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'i'}}, nil)
	if cmd == nil {
		t.Fatal("`i` returned nil cmd; expected an InspectRequest emitter")
	}
	if _, ok := cmd().(InspectRequest); !ok {
		t.Errorf("`i` produced %T, want InspectRequest", cmd())
	}
}

// TestRunsOKeyDoesNotInspect asserts that the legacy `o` binding no
// longer triggers the raw-inspect overlay. `o` becomes the external-
// viewer hook (stubbed for now); this guards against regressions.
func TestRunsOKeyDoesNotInspect(t *testing.T) {
	r := buildRunWithSpan()

	cmd := r.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'o'}}, nil)
	if cmd == nil {
		return // perfectly fine — `o` is a stub for now
	}
	if _, ok := cmd().(InspectRequest); ok {
		t.Errorf("`o` still emits InspectRequest — it should be reserved for external viewer per KEYBINDS contract")
	}
}

// TestRunsKeybindsAdvertiseInspectKey asserts the Keybinds() list now
// surfaces `i inspect raw` and `o open in viewer` — matching what
// Update() actually does. No more `o inspect` lie.
func TestRunsKeybindsAdvertiseInspectKey(t *testing.T) {
	r := NewRuns()
	binds := r.Keybinds()
	gotI, gotO := false, false
	for _, b := range binds {
		if b.Key == "i" {
			gotI = true
		}
		if b.Key == "o" && b.Label != "inspect" {
			gotO = true
		}
		if b.Key == "o" && b.Label == "inspect" {
			t.Errorf("Runs Keybinds still labels `o` as \"inspect\" — should be \"open in viewer\" per KEYBINDS contract")
		}
	}
	if !gotI {
		t.Errorf("Runs Keybinds missing `i` (inspect raw)")
	}
	if !gotO {
		t.Errorf("Runs Keybinds missing or wrongly-labelled `o`")
	}
}

// buildRunWithSpan constructs a Runs screen state where one span is
// loaded and selected — enough to exercise the inspect path.
func buildRunWithSpan() *Runs {
	r := NewRuns()
	r.loaded = true
	body, _ := json.Marshal(map[string]any{"hello": "world"})
	r.detail = &api.QualityRunDetailRecord{
		Spans: []api.QualityRunSpan{
			{ID: "sp1", Name: "agent.run", Data: json.RawMessage(body)},
		},
	}
	r.selRun = "8af2f1c"
	r.selSpan = "sp1"
	return r
}
