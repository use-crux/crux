package screens

import (
	"context"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

// Actions returns Overview's executable focused-pane and workflow actions.
// The focused pane owns list movement; focus traversal and drill-down remain
// workflow-level operations.
func (o *Overview) Actions(_ context.Context, _ DataClient) []interaction.Action {
	return []interaction.Action{
		o.navigationAction("overview.next", []string{"j", "down"}, "j/↓", "next"),
		o.navigationAction("overview.previous", []string{"k", "up"}, "k/↑", "previous"),
		o.navigationAction("overview.page-down", []string{"pgdown"}, "pgdn", "next page"),
		o.navigationAction("overview.page-up", []string{"pgup"}, "pgup", "previous page"),
		o.navigationAction("overview.first", []string{"home"}, "home", "first"),
		o.navigationAction("overview.last", []string{"end"}, "end", "last"),
		{
			ID:      "overview.previous-pane",
			Binding: key.NewBinding(key.WithKeys("h", "left"), key.WithHelp("h/←", "previous pane")),
			Run: func() tea.Cmd {
				o.shiftFocus(-1)
				return nil
			},
		},
		{
			ID:      "overview.next-pane",
			Binding: key.NewBinding(key.WithKeys("l", "right"), key.WithHelp("l/→", "next pane")),
			Run: func() tea.Cmd {
				o.shiftFocus(1)
				return nil
			},
		},
		{
			ID:             "overview.activate",
			Binding:        key.NewBinding(key.WithKeys("enter"), key.WithHelp("↵", o.activateLabel())),
			DisabledReason: o.activateDisabledReason(),
			Run:            o.drill,
		},
	}
}

func (o *Overview) navigationAction(id string, keys []string, helpKey, label string) interaction.Action {
	return interaction.Action{
		ID:      id,
		Binding: key.NewBinding(key.WithKeys(keys...), key.WithHelp(helpKey, label+" "+o.focusItemLabel())),
		Run: func() tea.Cmd {
			o.updateFocusedPane(tea.KeyPressMsg{Code: keyCode(keys[0]), Text: keyText(keys[0])})
			return nil
		},
	}
}

func (o *Overview) updateFocusedPane(msg tea.Msg) bool {
	switch o.focusedPanel {
	case panelInsights:
		return o.insightList.Update(msg)
	case panelRuns:
		return o.runList.Update(msg)
	case panelActivity:
		key, ok := msg.(tea.KeyPressMsg)
		if !ok {
			return false
		}
		switch key.String() {
		case "j", "down":
			o.moveCursor(1)
		case "k", "up":
			o.moveCursor(-1)
		case "pgdown":
			o.moveCursor(max(1, o.activityPage))
		case "pgup":
			o.moveCursor(-max(1, o.activityPage))
		case "home":
			o.activityScroll = 0
		case "end":
			o.activityScroll = max(0, len(o.projectedActivityRows())-1)
		default:
			return false
		}
		return true
	default:
		return false
	}
}

func (o *Overview) setFocusedPanel(panel overviewPanel) {
	o.focusedPanel = panel
	o.insightList.SetFocused(panel == panelInsights)
	o.runList.SetFocused(panel == panelRuns)
}

func (o *Overview) focusItemLabel() string {
	switch o.focusedPanel {
	case panelRuns:
		return "run"
	case panelActivity:
		return "activity"
	default:
		return "insight"
	}
}

func (o *Overview) activateLabel() string {
	if o.focusedPanel == panelRuns {
		return "open run"
	}
	return "open insight"
}

func (o *Overview) activateDisabledReason() string {
	switch o.focusedPanel {
	case panelInsights:
		return disabledUnless(o.SelectedInsightID() != "", "select an insight to open")
	case panelRuns:
		return disabledUnless(o.SelectedRunID() != "", "select a run to open")
	default:
		return "activity rows have no drill-down"
	}
}

func keyCode(name string) rune {
	switch name {
	case "pgdown":
		return tea.KeyPgDown
	case "pgup":
		return tea.KeyPgUp
	case "home":
		return tea.KeyHome
	case "end":
		return tea.KeyEnd
	default:
		return rune(name[0])
	}
}

func keyText(name string) string {
	if len(name) == 1 {
		return name
	}
	return ""
}

func (o *Overview) Keybinds() []shell.Keybind {
	return actionKeybinds(o.Actions(context.TODO(), nil), nil)
}
