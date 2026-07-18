package screens

import (
	"context"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Runs) updateKey(ctx context.Context, msg tea.KeyPressMsg, client DataClient) tea.Cmd {
	if !s.filteringRuns {
		if cmd, handled := s.updateRunListInput(ctx, msg, client); handled {
			return cmd
		}
	}
	if cmd, handled := interaction.Dispatch(s.Actions(ctx, client), msg); handled {
		return cmd
	}
	if s.filteringRuns {
		return s.updateRunFilter(ctx, msg, client)
	}
	return nil
}

// Actions returns the executable actions for the active Runs interaction
// scope. Filter controls replace workflow actions while filtering.
func (s *Runs) Actions(ctx context.Context, client DataClient) []interaction.Action {
	if s.filteringRuns {
		return s.filterActions(ctx, client)
	}

	inspectReason := ""
	if span := s.currentSpan(); span == nil || len(span.Data) == 0 {
		inspectReason = "selected span has no raw payload"
	}
	exportReason := ""
	detailSnapshot := s.detailResource.Snapshot()
	selectedID := s.SelectedRunID()
	if !detailSnapshot.HasValue || selectedID == "" || detailSnapshot.Value.Run.RunID != selectedID {
		exportReason = "load a run before exporting"
	}
	activateReason := ""
	switch s.focus {
	case focusRuns:
		activateReason = disabledUnless(selectedID != "", "select a run to load")
	case focusWaterfall:
		activateReason = disabledUnless(s.currentSpan() != nil, "select a span to open")
	default:
		activateReason = "the detail pane has no open action"
	}
	return []interaction.Action{
		{
			ID:      "runs.next",
			Binding: key.NewBinding(key.WithKeys("j", "down"), key.WithHelp("j/↓", "next "+s.focusItemLabel())),
			Run:     func() tea.Cmd { return s.moveDown(ctx, client) },
		},
		{
			ID:      "runs.previous",
			Binding: key.NewBinding(key.WithKeys("k", "up"), key.WithHelp("k/↑", "previous "+s.focusItemLabel())),
			Run:     func() tea.Cmd { return s.moveUp(ctx, client) },
		},
		{
			ID:             "runs.page-down",
			Binding:        key.NewBinding(key.WithKeys("pgdown"), key.WithHelp("pgdn", "next run page")),
			DisabledReason: disabledUnless(s.focus == focusRuns, "focus the run list to page"),
			Run: func() tea.Cmd {
				cmd, _ := s.updateRunListInput(ctx, tea.KeyPressMsg{Code: tea.KeyPgDown}, client)
				return cmd
			},
		},
		{
			ID:             "runs.page-up",
			Binding:        key.NewBinding(key.WithKeys("pgup"), key.WithHelp("pgup", "previous run page")),
			DisabledReason: disabledUnless(s.focus == focusRuns, "focus the run list to page"),
			Run: func() tea.Cmd {
				cmd, _ := s.updateRunListInput(ctx, tea.KeyPressMsg{Code: tea.KeyPgUp}, client)
				return cmd
			},
		},
		{
			ID:             "runs.first",
			Binding:        key.NewBinding(key.WithKeys("home"), key.WithHelp("home", "first run")),
			DisabledReason: disabledUnless(s.focus == focusRuns, "focus the run list to move"),
			Run: func() tea.Cmd {
				cmd, _ := s.updateRunListInput(ctx, tea.KeyPressMsg{Code: tea.KeyHome}, client)
				return cmd
			},
		},
		{
			ID:             "runs.last",
			Binding:        key.NewBinding(key.WithKeys("end"), key.WithHelp("end", "last run")),
			DisabledReason: disabledUnless(s.focus == focusRuns, "focus the run list to move"),
			Run: func() tea.Cmd {
				cmd, _ := s.updateRunListInput(ctx, tea.KeyPressMsg{Code: tea.KeyEnd}, client)
				return cmd
			},
		},
		{
			ID:      "runs.previous-pane",
			Binding: key.NewBinding(key.WithKeys("h", "left"), key.WithHelp("h/←", "previous pane")),
			Run: func() tea.Cmd {
				s.shiftFocus(-1)
				return nil
			},
		},
		{
			ID:      "runs.next-pane",
			Binding: key.NewBinding(key.WithKeys("l", "right"), key.WithHelp("l/→", "next pane")),
			Run: func() tea.Cmd {
				s.shiftFocus(1)
				return nil
			},
		},
		{
			ID:             "runs.activate",
			Binding:        key.NewBinding(key.WithKeys("enter"), key.WithHelp("↵", focusActionLabel(s.focus))),
			DisabledReason: activateReason,
			Run:            func() tea.Cmd { return s.activateFocus(ctx, client) },
		},
		{
			ID:             "runs.filter",
			Binding:        key.NewBinding(key.WithKeys("/"), key.WithHelp("/", "filter runs")),
			DisabledReason: disabledUnless(s.focus == focusRuns, "focus the run list to filter"),
			Run: func() tea.Cmd {
				s.filteringRuns = true
				return nil
			},
		},
		{
			ID:             "runs.status-filter",
			Binding:        key.NewBinding(key.WithKeys("f"), key.WithHelp("f", "status filter")),
			DisabledReason: disabledUnless(s.focus == focusRuns, "focus the run list to filter"),
			Run:            func() tea.Cmd { return s.cycleRunStatusFilter(ctx, client) },
		},
		{
			ID:             "runs.inspect",
			Binding:        key.NewBinding(key.WithKeys("i"), key.WithHelp("i", "inspect raw")),
			DisabledReason: inspectReason,
			Run:            s.openInspect,
		},
		{
			ID:             "runs.export",
			Binding:        key.NewBinding(key.WithKeys("e"), key.WithHelp("e", "export run")),
			DisabledReason: exportReason,
			Run:            s.exportRun,
		},
	}
}

func (s *Runs) filterActions(ctx context.Context, client DataClient) []interaction.Action {
	return []interaction.Action{
		{
			ID:      "runs.filter.finish",
			Binding: key.NewBinding(key.WithKeys("enter", "esc"), key.WithHelp("enter/esc", "finish filter")),
			Run: func() tea.Cmd {
				s.filteringRuns = false
				return s.ensureFilteredRunSelection(ctx, client)
			},
		},
		{
			ID:             "runs.filter.delete",
			Binding:        key.NewBinding(key.WithKeys("backspace"), key.WithHelp("⌫", "delete")),
			DisabledReason: disabledUnless(s.runQuery != "", "filter is empty"),
			Run: func() tea.Cmd {
				runes := []rune(s.runQuery)
				s.runQuery = string(runes[:len(runes)-1])
				return s.ensureFilteredRunSelection(ctx, client)
			},
		},
	}
}

func (s *Runs) Keybinds() []shell.Keybind {
	return actionKeybinds(s.Actions(context.TODO(), nil), nil)
}

func (s *Runs) waterfallKeybinds() []shell.Keybind {
	if s.focus != focusWaterfall {
		return nil
	}
	return actionKeybinds(s.Actions(context.TODO(), nil), map[string]bool{
		"runs.activate": true,
		"runs.inspect":  true,
		"runs.export":   true,
	})
}

func actionKeybinds(actions []interaction.Action, allowed map[string]bool) []shell.Keybind {
	bindings := make([]shell.Keybind, 0, len(actions))
	for _, action := range actions {
		if allowed != nil && !allowed[action.ID] {
			continue
		}
		if !action.Enabled() {
			continue
		}
		item := action.Binding.Help()
		if item.Key != "" && item.Desc != "" {
			bindings = append(bindings, shell.Bind(item.Key, item.Desc))
		}
	}
	return bindings
}

func (s *Runs) focusItemLabel() string {
	if s.focus == focusRuns {
		return "run"
	}
	return "span"
}

func disabledUnless(enabled bool, reason string) string {
	if enabled {
		return ""
	}
	return reason
}
