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

type passiveScreen struct{ id string }

func (s *passiveScreen) ID() string                                 { return s.id }
func (s *passiveScreen) Init(screens.DataClient) tea.Cmd            { return nil }
func (s *passiveScreen) Update(tea.Msg, screens.DataClient) tea.Cmd { return nil }
func (s *passiveScreen) View(screens.Size) string                   { return "" }
func (s *passiveScreen) Breadcrumb() ([]string, string)             { return []string{s.id}, "" }
func (s *passiveScreen) Keybinds() []shell.Keybind                  { return nil }
func (s *passiveScreen) Counts() map[string]int                     { return nil }
func (s *passiveScreen) Interested(bridge.Domains) bool             { return false }

func TestGotoNavAllowsDestinationWithoutFocusCapability(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.screens["index"] = &passiveScreen{id: "index"}

	w.gotoNav("index")

	if w.activeNav != "index" {
		t.Fatalf("active nav = %q, want index", w.activeNav)
	}
}

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

// TestGotoNavInvokesFocusForLegacySelectionAdapter asserts that an unmigrated
// screen can still consume selection-store state until route ownership moves
// into that workflow.
func TestGotoNavInvokesFocusForLegacySelectionAdapter(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	// Replace one of the real screens with our recorder.
	fake := &fakeScreen{id: "insights"}
	w.screens["insights"] = fake

	// Stage an insight id and jump to the still-adapted Insights screen.
	w.SetSelection(KindInsight, "INS-014")
	w.gotoNav("insights")

	if len(fake.focusCalls) != 1 {
		t.Fatalf("expected 1 Focus call on destination screen, got %d: %v", len(fake.focusCalls), fake.focusCalls)
	}
	got := fake.focusCalls[0]
	if got.kind != string(KindInsight) || got.id != "INS-014" {
		t.Errorf("Focus call = {%q, %q}, want {%q, %q}", got.kind, got.id, KindInsight, "INS-014")
	}
}

func TestGotoNavDoesNotReplayLegacyRunSelection(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	fake := &fakeScreen{id: "runs"}
	w.screens["runs"] = fake
	w.SetSelection(KindRun, "stale-run")

	w.gotoNav("runs")

	if len(fake.focusCalls) != 0 {
		t.Fatalf("migrated Runs received stale legacy focus: %#v", fake.focusCalls)
	}
}

// TestGotoNavSkipsFocusWhenNoSelection asserts that jumping to a screen
// with no staged record does NOT invoke Focus — silent no-call is the
// signal that the screen should keep its own default selection.
func TestGotoNavSkipsFocusWhenNoSelection(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	fake := &fakeScreen{id: "index"}
	w.screens["index"] = fake

	// No record has been staged for any mounted destination.
	w.gotoNav("index")

	if len(fake.focusCalls) != 0 {
		t.Errorf("expected zero Focus calls when no selection staged, got %d: %v", len(fake.focusCalls), fake.focusCalls)
	}
}
