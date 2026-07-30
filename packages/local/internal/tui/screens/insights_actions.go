package screens

import (
	"context"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
)

// Actions is the single executable key registry for Insights. Esc is
// deliberately workspace-owned so cross-screen drills can navigate back.
func (s *Insights) Actions(ctx context.Context, client DataClient) []interaction.Action {
	current := s.currentInsight()
	recordReason := disabledUnless(current != nil, "select an insight")
	traceReason := recordReason
	if current != nil {
		traceReason = disabledUnless(len(current.LinkedTraceIDs) > 0, "selected insight has no linked traces")
	}
	return []interaction.Action{
		{
			ID:      "insights.next",
			Binding: key.NewBinding(key.WithKeys("j", "down"), key.WithHelp("j/↓", "next insight")),
			Run: func() tea.Cmd {
				s.moveSelection(1)
				return nil
			},
		},
		{
			ID:      "insights.previous",
			Binding: key.NewBinding(key.WithKeys("k", "up"), key.WithHelp("k/↑", "previous insight")),
			Run: func() tea.Cmd {
				s.moveSelection(-1)
				return nil
			},
		},
		{
			ID:      "insights.previous-pane",
			Binding: key.NewBinding(key.WithKeys("h", "left"), key.WithHelp("h/←", "previous pane")),
			Run: func() tea.Cmd {
				s.shiftFocus(-1)
				return nil
			},
		},
		{
			ID:      "insights.next-pane",
			Binding: key.NewBinding(key.WithKeys("l", "right", "enter"), key.WithHelp("l/→/↵", "next pane")),
			Run: func() tea.Cmd {
				s.shiftFocus(1)
				return nil
			},
		},
		{
			ID:      "insights.previous-tab",
			Binding: key.NewBinding(key.WithKeys("[", "shift+tab"), key.WithHelp("[/shift+tab", "previous tab")),
			Run: func() tea.Cmd {
				s.cycleTab(-1)
				return nil
			},
		},
		{
			ID:      "insights.next-tab",
			Binding: key.NewBinding(key.WithKeys("]", "tab"), key.WithHelp("]/tab", "next tab")),
			Run: func() tea.Cmd {
				s.cycleTab(1)
				return nil
			},
		},
		{
			ID:             "insights.dismiss",
			Binding:        key.NewBinding(key.WithKeys("x"), key.WithHelp("x", "dismiss")),
			DisabledReason: recordReason,
			Run:            func() tea.Cmd { return s.dismiss(ctx, client) },
		},
		{
			ID:             "insights.fixed",
			Binding:        key.NewBinding(key.WithKeys("f"), key.WithHelp("f", "mark fixed")),
			DisabledReason: recordReason,
			Run:            func() tea.Cmd { return s.markFixed(ctx, client) },
		},
		{
			ID:             "insights.traces",
			Binding:        key.NewBinding(key.WithKeys("t"), key.WithHelp("t", "linked traces")),
			DisabledReason: traceReason,
			Run:            s.openLinkedTrace,
		},
		{
			ID:             "insights.export",
			Binding:        key.NewBinding(key.WithKeys("e"), key.WithHelp("e", "export insight")),
			DisabledReason: recordReason,
			Run:            s.exportInsight,
		},
	}
}
