package tui

import (
	"context"
	"strings"
	"testing"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

type fakeActionScreen struct {
	*fakeScreen
	actions []interaction.Action
}

func (s *fakeActionScreen) Actions(context.Context, screens.DataClient) []interaction.Action {
	return s.actions
}

func TestWorkbenchHelpRendersExecutableWorkspaceActionsForLegacyScreen(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(160, 40)
	w.Update(tea.KeyPressMsg(tea.Key{Text: "?", Code: '?'}))
	out := w.View()

	if !strings.Contains(out, "? help") {
		t.Fatalf("workbench did not render the help overlay after `?`:\n%s", out)
	}
	if !strings.Contains(strings.ToLower(out), "workspace") || !strings.Contains(out, "command palette") {
		t.Errorf("help overlay omitted executable workspace actions:\n%s", out)
	}
	if strings.Contains(strings.ToLower(out), "act · overview") {
		t.Errorf("help treated legacy Overview hints as executable actions:\n%s", out)
	}
}

func TestWorkbenchHelpAdvertisesOnlyExecutableActions(t *testing.T) {
	w := newTestWorkbench(nil, nil, "http://localhost:4400")
	w.Resize(160, 40)
	w.screens["overview"] = &fakeActionScreen{
		fakeScreen: &fakeScreen{id: "overview"},
		actions: []interaction.Action{
			{
				ID:      "execute",
				Binding: key.NewBinding(key.WithKeys("e"), key.WithHelp("e", "execute action")),
				Run:     func() tea.Cmd { return nil },
			},
			{
				ID:      "no-handler",
				Binding: key.NewBinding(key.WithKeys("n"), key.WithHelp("n", "no-op action")),
			},
		},
	}

	w.Update(tea.KeyPressMsg(tea.Key{Text: "?", Code: '?'}))
	out := w.View()

	if !strings.Contains(out, "execute action") {
		t.Fatalf("help omitted executable action:\n%s", out)
	}
	if strings.Contains(out, "no-op action") {
		t.Fatalf("help advertised action without a handler:\n%s", out)
	}
}
