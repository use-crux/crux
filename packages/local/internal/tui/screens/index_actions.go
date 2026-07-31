package screens

import (
	"context"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Actions returns Index's executable browser, detail, and workflow actions.
func (s *Index) Actions(ctx context.Context, client DataClient) []interaction.Action {
	pageDownKeys := []string{"pgdown", "ctrl+d"}
	pageUpKeys := []string{"pgup", "ctrl+u"}
	firstKeys := []string{"home"}
	lastKeys := []string{"end"}
	firstHelp := "home"
	lastHelp := "end"
	if s.focus == indexFocusDetail {
		firstKeys = append(firstKeys, "g")
		lastKeys = append(lastKeys, "G")
		firstHelp = "home/g"
		lastHelp = "end/G"
	}
	return []interaction.Action{
		s.indexNavigationAction(ctx, client, "index.next", []string{"j", "down"}, "j/↓", "next "+s.focusItemLabel()),
		s.indexNavigationAction(ctx, client, "index.previous", []string{"k", "up"}, "k/↑", "previous "+s.focusItemLabel()),
		s.indexNavigationAction(ctx, client, "index.page-down", pageDownKeys, "pgdn/^d", "next "+s.focusPageLabel()),
		s.indexNavigationAction(ctx, client, "index.page-up", pageUpKeys, "pgup/^u", "previous "+s.focusPageLabel()),
		s.indexNavigationAction(ctx, client, "index.first", firstKeys, firstHelp, "first "+s.focusItemLabel()),
		s.indexNavigationAction(ctx, client, "index.last", lastKeys, lastHelp, "last "+s.focusItemLabel()),
		{
			ID:             "index.activate",
			Binding:        key.NewBinding(key.WithKeys("enter"), key.WithHelp("↵", s.activateLabel())),
			DisabledReason: s.activateDisabledReason(),
			Run: func() tea.Cmd {
				if s.focus == indexFocusDetail {
					target := s.selectedRelationTarget()
					if target == "" {
						return nil
					}
					return func() tea.Msg {
						return NavigateRequest{NavID: "index", Kind: "definition", ID: target}
					}
				}
				document := s.syncDetail()
				s.setFocus(indexFocusDetail)
				if document.hasLint {
					s.detail.RestoreAnchor(document.lintAnchor)
				}
				return nil
			},
		},
		{
			ID:             "index.group",
			Binding:        key.NewBinding(key.WithKeys("v"), key.WithHelp("v", "group by "+s.nextGroupAxisLabel())),
			DisabledReason: disabledUnless(len(s.indexData().Definitions) > 0, "no definitions to group"),
			Run: func() tea.Cmd {
				s.toggleGroupAxis()
				return nil
			},
		},
		{
			ID:             "index.suppressed",
			Binding:        key.NewBinding(key.WithKeys("s"), key.WithHelp("s", s.suppressedActionLabel())),
			DisabledReason: disabledUnless(s.hasSuppressedFindings(), "no suppressed findings"),
			Run: func() tea.Cmd {
				s.showSuppressed = !s.showSuppressed
				s.syncDetail()
				return nil
			},
		},
		{
			ID:             "index.runs",
			Binding:        key.NewBinding(key.WithKeys("r"), key.WithHelp("r", "open definition runs")),
			DisabledReason: disabledUnless(s.currentDefinitionActivity().RunCount > 0, "no runtime activity"),
			Run: func() tea.Cmd {
				definitionID := s.SelectedDefinitionID()
				return func() tea.Msg {
					return NavigateRequest{NavID: "runs", Kind: "definition", ID: definitionID}
				}
			},
		},
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
			Binding:        key.NewBinding(key.WithKeys("x"), key.WithHelp("x", "export definition")),
			DisabledReason: disabledUnless(s.SelectedDefinitionID() != "", "select a definition to export"),
			Run:            s.exportDefinition,
		},
	}
}

func (s *Index) indexNavigationAction(
	ctx context.Context,
	client DataClient,
	id string,
	keys []string,
	helpKey string,
	label string,
) interaction.Action {
	return interaction.Action{
		ID:             id,
		Binding:        key.NewBinding(key.WithKeys(keys...), key.WithHelp(helpKey, label)),
		DisabledReason: disabledUnless(s.focusHasNavigableContent(), "focused pane is empty"),
		Run: func() tea.Cmd {
			if s.focus == indexFocusDetail && s.moveRelation(keys[0]) {
				return nil
			}
			before := s.SelectedDefinitionID()
			s.updateFocusedPane(tea.KeyPressMsg{Code: keyCode(keys[0]), Text: keyText(keys[0])})
			if before != s.SelectedDefinitionID() {
				s.relationCursor = 0
				return s.fetchDefinitionActivity(ctx, client)
			}
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
		if s.relationCount() > 0 {
			return "relation"
		}
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

func (s *Index) activateLabel() string {
	if s.focus == indexFocusDetail && s.selectedRelationTarget() != "" {
		return "open relation"
	}
	return "open detail"
}

func (s *Index) activateDisabledReason() string {
	if s.SelectedDefinitionID() == "" {
		return "select a definition"
	}
	if s.focus == indexFocusDetail && s.selectedRelationTarget() == "" {
		return "no relation selected"
	}
	return ""
}
