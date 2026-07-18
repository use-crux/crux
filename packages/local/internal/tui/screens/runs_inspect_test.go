package screens

import (
	"encoding/json"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

// TestRunsInspectKeyIsI asserts the in-TUI raw-inspect overlay opens on
// `i` (not `o`). Per the KEYBINDS.md contract, `o` is reserved for
// "open in external viewer"; raw-inspect drops to Layer-3 `i`. See S7.
func TestRunsInspectKeyIsI(t *testing.T) {
	r := buildRunWithSpan()

	// `i` should emit an InspectRequest via the returned tea.Cmd.
	cmd := r.Update(tea.KeyPressMsg(tea.Key{Text: "i", Code: 'i'}), nil)
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

	cmd := r.Update(tea.KeyPressMsg(tea.Key{Text: "o", Code: 'o'}), nil)
	if cmd == nil {
		return // perfectly fine — `o` is a stub for now
	}
	if _, ok := cmd().(InspectRequest); ok {
		t.Errorf("`o` still emits InspectRequest — it should be reserved for external viewer per KEYBINDS contract")
	}
}

// TestRunsKeybindsAdvertiseOnlyExecutableInspectAction asserts that raw
// inspection is visible when the selected span has data, while the unimplemented
// external-viewer action remains absent.
func TestRunsKeybindsAdvertiseOnlyExecutableInspectAction(t *testing.T) {
	r := buildRunWithSpan()
	binds := r.Keybinds()
	gotI := false
	for _, b := range binds {
		if b.Key == "i" {
			gotI = true
		}
		if b.Key == "o" {
			t.Errorf("Runs Keybinds advertised unimplemented external viewer action")
		}
	}
	if !gotI {
		t.Errorf("Runs Keybinds missing `i` (inspect raw)")
	}
}

// buildRunWithSpan constructs a Runs screen state where one span is
// loaded and selected — enough to exercise the inspect path.
func buildRunWithSpan() *Runs {
	r := NewRuns()
	r.loaded = true
	body, _ := json.Marshal(map[string]any{"hello": "world"})
	r.detail = &api.InspectRunDetailRecord{
		Spans: []api.InspectRunSpan{
			{ID: "sp1", Name: "agent.run", Data: json.RawMessage(body)},
		},
	}
	r.selRun = "8af2f1c"
	r.selSpan = "sp1"
	return r
}
