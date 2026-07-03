package tui

import (
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// fakeScreen is a minimal Screen impl that records Focus calls so we can
// assert the workbench's selection-routing wiring works end-to-end.
type fakeScreen struct {
	id         string
	interest   bridge.Domains
	initCalls  int
	updateMsgs []tea.Msg
	focusCalls []focusCall
}

type focusCall struct{ kind, id string }

func (s *fakeScreen) ID() string { return s.id }
func (s *fakeScreen) Init(_ screens.DataClient) tea.Cmd {
	return func() tea.Msg {
		s.initCalls++
		return nil
	}
}
func (s *fakeScreen) Update(msg tea.Msg, _ screens.DataClient) tea.Cmd {
	s.updateMsgs = append(s.updateMsgs, msg)
	return nil
}
func (s *fakeScreen) View(_ screens.Size) string             { return "" }
func (s *fakeScreen) Breadcrumb() ([]string, string)         { return []string{s.id}, "" }
func (s *fakeScreen) Keybinds() []shell.Keybind              { return nil }
func (s *fakeScreen) Counts() map[string]int                 { return nil }
func (s *fakeScreen) Interested(domains bridge.Domains) bool { return s.interest.Intersects(domains) }
func (s *fakeScreen) Focus(kind, id string)                  { s.focusCalls = append(s.focusCalls, focusCall{kind, id}) }

// TestGotoNavInvokesFocusOnDestination asserts that when the user jumps
// to a screen via the workbench's nav routing AND a matching record is
// staged in the cross-screen selection store, the destination screen
// receives a Focus(kind, id) call before becoming active. See ADR-0051.
func TestGotoNavInvokesFocusOnDestination(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	// Replace one of the real screens with our recorder.
	fake := &fakeScreen{id: "runs"}
	w.screens["runs"] = fake

	// Stage a run id and jump to the runs screen.
	w.SetSelection(KindRun, "8af2f1c")
	w.gotoNav("runs")

	if len(fake.focusCalls) != 1 {
		t.Fatalf("expected 1 Focus call on destination screen, got %d: %v", len(fake.focusCalls), fake.focusCalls)
	}
	got := fake.focusCalls[0]
	if got.kind != string(KindRun) || got.id != "8af2f1c" {
		t.Errorf("Focus call = {%q, %q}, want {%q, %q}", got.kind, got.id, KindRun, "8af2f1c")
	}
}

// TestGotoNavSkipsFocusWhenNoSelection asserts that jumping to a screen
// with no staged record does NOT invoke Focus — silent no-call is the
// signal that the screen should keep its own default selection.
func TestGotoNavSkipsFocusWhenNoSelection(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	fake := &fakeScreen{id: "experiments"}
	w.screens["experiments"] = fake

	// Nothing staged for KindExperiment.
	w.gotoNav("experiments")

	if len(fake.focusCalls) != 0 {
		t.Errorf("expected zero Focus calls when no selection staged, got %d: %v", len(fake.focusCalls), fake.focusCalls)
	}
}
