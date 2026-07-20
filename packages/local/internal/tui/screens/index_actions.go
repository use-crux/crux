package screens

import (
	"context"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Actions returns Index's executable focused-list and export actions.
func (s *Index) Actions(_ context.Context, _ DataClient) []interaction.Action {
	return []interaction.Action{
		s.indexNavigationAction("index.next", []string{"j", "down"}, "j/↓", "next "+s.focusItemLabel()),
		s.indexNavigationAction("index.previous", []string{"k", "up"}, "k/↑", "previous "+s.focusItemLabel()),
		s.indexNavigationAction("index.page-down", []string{"pgdown", "ctrl+d"}, "pgdn/ctrl+d", "next "+s.focusPageLabel()),
		s.indexNavigationAction("index.page-up", []string{"pgup", "ctrl+u"}, "pgup/ctrl+u", "previous "+s.focusPageLabel()),
		s.indexNavigationAction("index.first", []string{"home"}, "home", "first "+s.focusItemLabel()),
		s.indexNavigationAction("index.last", []string{"end"}, "end", "last "+s.focusItemLabel()),
		{
			ID:             "index.previous-pane",
			Binding:        key.NewBinding(key.WithKeys("h", "left", "shift+tab"), key.WithHelp("h/←/shift+tab", "previous pane")),
			DisabledReason: disabledUnless(s.focus == indexFocusDetail && s.SelectedDefinitionID() != "", "no previous visible pane"),
			Run: func() tea.Cmd {
				s.shiftFocus(-1)
				return nil
			},
		},
		{
			ID:             "index.next-pane",
			Binding:        key.NewBinding(key.WithKeys("l", "right", "tab"), key.WithHelp("l/→/tab", "next pane")),
			DisabledReason: disabledUnless(s.focus == indexFocusDefinitions && s.SelectedDefinitionID() != "", "no next visible pane"),
			Run: func() tea.Cmd {
				s.shiftFocus(1)
				return nil
			},
		},
		{
			ID:             "index.export",
			Binding:        key.NewBinding(key.WithKeys("e"), key.WithHelp("e", "export definition")),
			DisabledReason: disabledUnless(s.SelectedDefinitionID() != "", "select a definition to export"),
			Run:            s.exportDefinition,
		},
	}
}

func (s *Index) indexNavigationAction(id string, keys []string, helpKey, label string) interaction.Action {
	return interaction.Action{
		ID:             id,
		Binding:        key.NewBinding(key.WithKeys(keys...), key.WithHelp(helpKey, label)),
		DisabledReason: disabledUnless(s.focusHasNavigableContent(), "focused pane is empty"),
		Run: func() tea.Cmd {
			s.updateFocusedPane(tea.KeyPressMsg{Code: keyCode(keys[0]), Text: keyText(keys[0])})
			return nil
		},
	}
}

func (s *Index) focusHasNavigableContent() bool {
	if s.unavailableDefinitionID != "" {
		return false
	}
	if s.focus == indexFocusDetail {
		return s.detail.Position().TotalLines > 0
	}
	return s.definitions.Position().Total > 0
}

func (s *Index) updateFocusedPane(msg tea.Msg) bool {
	if s.focus == indexFocusDetail {
		return s.detail.Update(msg)
	}
	selected := s.SelectedDefinitionID()
	handled := s.definitions.Update(msg)
	if handled && selected != s.SelectedDefinitionID() {
		s.routedDefinitionID = ""
		s.routedDefinitionAnchorPending = false
		s.unavailableDefinitionID = ""
		s.syncDetail()
	}
	return handled
}

func (s *Index) setFocus(focus indexFocus) {
	s.focus = focus
	s.definitions.SetFocused(focus == indexFocusDefinitions)
	s.detail.SetFocused(focus == indexFocusDetail)
}

func (s *Index) shiftFocus(delta int) {
	next := int(s.focus) + delta
	if next < int(indexFocusDefinitions) {
		next = int(indexFocusDefinitions)
	}
	if next > int(indexFocusDetail) {
		next = int(indexFocusDetail)
	}
	s.setFocus(indexFocus(next))
}

func (s *Index) focusItemLabel() string {
	if s.focus == indexFocusDetail {
		return "line"
	}
	return "definition"
}

func (s *Index) focusPageLabel() string {
	if s.focus == indexFocusDetail {
		return "detail page"
	}
	return "definition page"
}

// Keybinds returns the same executable Index actions used for dispatch.
func (s *Index) Keybinds() []shell.Keybind {
	return actionKeybinds(s.Actions(context.TODO(), nil), nil)
}
