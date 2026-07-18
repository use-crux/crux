package screens

import (
	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Runs) updateKey(msg tea.KeyPressMsg, client DataClient) tea.Cmd {
	if cmd, handled := interaction.Dispatch(s.Actions(client), msg); handled {
		return cmd
	}
	if s.filteringRuns {
		return s.updateRunFilter(msg, client)
	}
	return nil
}

// Actions returns the executable actions for the active Runs interaction
// scope. Filter controls replace workflow actions while filtering.
func (s *Runs) Actions(client DataClient) []interaction.Action {
	if s.filteringRuns {
		return s.filterActions(client)
	}

	inspectReason := ""
	if span := s.currentSpan(); span == nil || len(span.Data) == 0 {
		inspectReason = "selected span has no raw payload"
	}
	exportReason := ""
	if s.detail == nil || s.selRun == "" {
		exportReason = "load a run before exporting"
	}
	activateReason := ""
	switch s.focus {
	case focusRuns:
		activateReason = disabledUnless(s.selRun != "", "select a run to load")
	case focusWaterfall:
		activateReason = disabledUnless(s.currentSpan() != nil, "select a span to open")
	default:
		activateReason = "the detail pane has no open action"
	}
	return []interaction.Action{
		{
			ID:      "runs.next",
			Binding: key.NewBinding(key.WithKeys("j", "down"), key.WithHelp("j/↓", "next "+s.focusItemLabel())),
			Run:     func() tea.Cmd { return s.moveDown(client) },
		},
		{
			ID:      "runs.previous",
			Binding: key.NewBinding(key.WithKeys("k", "up"), key.WithHelp("k/↑", "previous "+s.focusItemLabel())),
			Run:     func() tea.Cmd { return s.moveUp(client) },
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
			Run:            func() tea.Cmd { return s.activateFocus(client) },
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
			Run:            func() tea.Cmd { return s.cycleRunStatusFilter(client) },
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

func (s *Runs) filterActions(client DataClient) []interaction.Action {
	return []interaction.Action{
		{
			ID:      "runs.filter.finish",
			Binding: key.NewBinding(key.WithKeys("enter", "esc"), key.WithHelp("enter/esc", "finish filter")),
			Run: func() tea.Cmd {
				s.filteringRuns = false
				return s.ensureFilteredRunSelection(client)
			},
		},
		{
			ID:             "runs.filter.delete",
			Binding:        key.NewBinding(key.WithKeys("backspace"), key.WithHelp("⌫", "delete")),
			DisabledReason: disabledUnless(s.runQuery != "", "filter is empty"),
			Run: func() tea.Cmd {
				runes := []rune(s.runQuery)
				s.runQuery = string(runes[:len(runes)-1])
				return s.ensureFilteredRunSelection(client)
			},
		},
	}
}

func (s *Runs) Keybinds() []shell.Keybind {
	return actionKeybinds(s.Actions(nil), nil)
}

func (s *Runs) waterfallKeybinds() []shell.Keybind {
	if s.focus != focusWaterfall {
		return nil
	}
	return actionKeybinds(s.Actions(nil), map[string]bool{
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
