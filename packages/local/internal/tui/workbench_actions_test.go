package tui

import (
	"strings"
	"testing"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

type fakeLegacyHandledScreen struct {
	*fakeScreen
	handledKey string
}

func (s *fakeLegacyHandledScreen) HandlesKey(msg tea.KeyPressMsg) bool {
	return msg.String() == s.handledKey
}

func TestWorkbenchFilteringHintsHideWorkspaceActions(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(120, 30)
	w.activeNav = "runs"
	w.screens["runs"] = screens.NewRuns()

	w.Update(tea.KeyPressMsg(tea.Key{Text: "/", Code: '/'}))
	out := ansi.Strip(w.View())

	if strings.Contains(out, "q quit") {
		t.Fatalf("filtering status advertised workspace quit:\n%s", out)
	}
	if !strings.Contains(out, "finish filter") {
		t.Fatalf("filtering status omitted executable filter controls:\n%s", out)
	}
}

func TestWorkbenchMigratedScreenDoesNotFallThroughToLegacyUpdate(t *testing.T) {
	screen := &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{
			{
				ID:      "execute",
				Binding: key.NewBinding(key.WithKeys("e")),
				Run:     func() tea.Cmd { return nil },
			},
		},
	}
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = screen

	w.Update(tea.KeyPressMsg(tea.Key{Text: "x", Code: 'x'}))

	if len(screen.updateMsgs) != 0 {
		t.Fatalf("migrated screen received legacy key updates: %v", screen.updateMsgs)
	}
}

func TestWorkbenchHelpDoesNotTreatLegacyHintsAsExecutableActions(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(160, 40)
	w.activeNav = "index"

	w.Update(tea.KeyPressMsg(tea.Key{Text: "?", Code: '?'}))
	out := ansi.Strip(w.View())

	if strings.Contains(out, "open in viewer") {
		t.Fatalf("help advertised a legacy no-op as executable:\n%s", out)
	}
}

func TestWorkbenchLegacyWorkflowPrecedesWorkspaceActions(t *testing.T) {
	screen := &fakeLegacyHandledScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		handledKey: "q",
	}
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = screen
	quitRequested := false
	w.SetQuitRequestedCallback(func() { quitRequested = true })

	w.Update(tea.KeyPressMsg(tea.Key{Text: "q", Code: 'q'}))

	if len(screen.updateMsgs) != 1 {
		t.Fatalf("legacy workflow updates = %d, want one", len(screen.updateMsgs))
	}
	if quitRequested {
		t.Fatal("workspace quit ran after legacy workflow consumed q")
	}
}

func TestWorkbenchClaimedPrefixResolvesBeforeWorkflowActions(t *testing.T) {
	workflowCalls := 0
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{
			{
				ID:      "workflow.inspect",
				Binding: key.NewBinding(key.WithKeys("i")),
				Run: func() tea.Cmd {
					workflowCalls++
					return nil
				},
			},
		},
	}

	w.Update(tea.KeyPressMsg(tea.Key{Text: "g", Code: 'g'}))
	w.Update(tea.KeyPressMsg(tea.Key{Text: "i", Code: 'i'}))

	if workflowCalls != 0 {
		t.Fatalf("workflow action ran %d times for claimed workspace prefix", workflowCalls)
	}
	if w.activeNav != "insights" {
		t.Fatalf("active nav = %q, want insights", w.activeNav)
	}
	if w.pendingPrefix != "" {
		t.Fatalf("pending prefix = %q, want cleared", w.pendingPrefix)
	}
}

func TestWorkbenchLegacyAdapterDropsUnclaimedKeys(t *testing.T) {
	screen := &fakeLegacyHandledScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		handledKey: "e",
	}
	w := NewWorkbench(nil, nil, "http://localhost:4400")
	w.screens["overview"] = screen

	w.Update(tea.KeyPressMsg(tea.Key{Text: "x", Code: 'x'}))

	if len(screen.updateMsgs) != 0 {
		t.Fatalf("legacy workflow received unclaimed key updates: %v", screen.updateMsgs)
	}
}
