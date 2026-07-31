package screens

import (
	"context"

	"charm.land/bubbles/v2/key"
	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/tui/interaction"
)

func (s *Evals) Actions(ctx context.Context, client DataClient) []interaction.Action {
	actions := []interaction.Action{
		s.catalogMoveAction(ctx, client, "evals.next", []string{"j", "down"}, "j/↓", 1),
		s.catalogMoveAction(ctx, client, "evals.previous", []string{"k", "up"}, "k/↑", -1),
		s.cellMoveAction(ctx, client, "evals.cell-left", []string{"h", "left"}, "h/←", 0, -1),
		s.cellMoveAction(ctx, client, "evals.cell-down", []string{"j", "down"}, "j/↓", 1, 0),
		s.cellMoveAction(ctx, client, "evals.cell-up", []string{"k", "up"}, "k/↑", -1, 0),
		s.cellMoveAction(ctx, client, "evals.cell-right", []string{"l", "right"}, "l/→", 0, 1),
		{
			ID:      "evals.next-pane",
			Binding: key.NewBinding(key.WithKeys("tab"), key.WithHelp("tab", "focus grid")),
			DisabledReason: disabledUnless(
				s.focus == evalsFocusCatalog && s.run.RunID != "", "no grid to focus",
			),
			Run: func() tea.Cmd {
				s.setFocus(evalsFocusGrid)
				s.syncDetail(true)
				return s.fetchSelectedLocalRun(ctx, client)
			},
		},
		{
			ID:      "evals.previous-pane",
			Binding: key.NewBinding(key.WithKeys("shift+tab"), key.WithHelp("shift+tab", "focus catalog")),
			DisabledReason: disabledUnless(
				s.focus == evalsFocusGrid, "catalog already focused",
			),
			Run: func() tea.Cmd {
				s.setFocus(evalsFocusCatalog)
				return nil
			},
		},
		{
			ID:             "evals.activate",
			Binding:        key.NewBinding(key.WithKeys("enter"), key.WithHelp("↵", s.activateLabel())),
			DisabledReason: s.activateDisabledReason(),
			Run: func() tea.Cmd {
				if s.focus == evalsFocusCatalog {
					s.setFocus(evalsFocusGrid)
					s.syncDetail(true)
					return s.fetchSelectedLocalRun(ctx, client)
				}
				runID := s.selectedObservedRunID()
				return func() tea.Msg {
					return NavigateRequest{NavID: "runs", Kind: "run", ID: runID}
				}
			},
		},
		s.historyAction(ctx, client, "evals.newer-run", "[", "[", -1),
		s.historyAction(ctx, client, "evals.older-run", "]", "]", 1),
	}
	return actions
}

func (s *Evals) catalogMoveAction(
	ctx context.Context,
	client DataClient,
	id string,
	keys []string,
	help string,
	delta int,
) interaction.Action {
	return interaction.Action{
		ID:      id,
		Binding: key.NewBinding(key.WithKeys(keys...), key.WithHelp(help, map[bool]string{true: "next eval", false: "previous eval"}[delta > 0])),
		DisabledReason: disabledUnless(
			s.focus == evalsFocusCatalog && s.catalog.Position().Total > 1, "catalog is not navigable",
		),
		Run: func() tea.Cmd {
			before := s.selectedEvalID()
			keyName := "j"
			if delta < 0 {
				keyName = "k"
			}
			s.catalog.Update(tea.KeyPressMsg{Text: keyName, Code: rune(keyName[0])})
			if before == s.selectedEvalID() {
				return nil
			}
			s.syncSelection()
			return s.ensureSelectedRun(ctx, client)
		},
	}
}

func (s *Evals) cellMoveAction(
	ctx context.Context,
	client DataClient,
	id string,
	keys []string,
	help string,
	rowDelta int,
	columnDelta int,
) interaction.Action {
	return interaction.Action{
		ID:      id,
		Binding: key.NewBinding(key.WithKeys(keys...), key.WithHelp(help, "move cell")),
		DisabledReason: disabledUnless(
			s.focus == evalsFocusGrid && s.canMoveCell(rowDelta, columnDelta), "no cell in that direction",
		),
		Run: func() tea.Cmd {
			s.cellRow += rowDelta
			s.cellColumn += columnDelta
			s.syncDetail(true)
			return s.fetchSelectedLocalRun(ctx, client)
		},
	}
}

func (s *Evals) historyAction(
	ctx context.Context,
	client DataClient,
	id string,
	keyName string,
	help string,
	delta int,
) interaction.Action {
	label := "older run"
	if delta < 0 {
		label = "newer run"
	}
	return interaction.Action{
		ID:      id,
		Binding: key.NewBinding(key.WithKeys(keyName), key.WithHelp(help, label)),
		DisabledReason: disabledUnless(
			s.focus == evalsFocusGrid && s.canMoveHistory(delta), "no "+label,
		),
		Run: func() tea.Cmd {
			history := s.historyForEval(s.selectedEvalID())
			index := s.selectedHistoryIndex()
			s.selectedRunID = history[index+delta].RunID
			s.run = evalRunItem{}
			s.cellRow, s.cellColumn = 0, 0
			s.syncDetail(false)
			return s.fetchSelectedRun(ctx, client, 0)
		},
	}
}

func (s *Evals) canMoveCell(rowDelta, columnDelta int) bool {
	row := s.cellRow + rowDelta
	column := s.cellColumn + columnDelta
	return row >= 0 && row < len(s.run.Cases) && column >= 0 && column < len(s.run.Variants)
}

func (s *Evals) clampCell() {
	s.cellRow = min(max(s.cellRow, 0), max(0, len(s.run.Cases)-1))
	s.cellColumn = min(max(s.cellColumn, 0), max(0, len(s.run.Variants)-1))
}

func (s *Evals) selectedHistoryIndex() int {
	for index, run := range s.historyForEval(s.selectedEvalID()) {
		if run.RunID == s.selectedRunID {
			return index
		}
	}
	return -1
}

func (s *Evals) canMoveHistory(delta int) bool {
	index := s.selectedHistoryIndex()
	next := index + delta
	history := s.historyForEval(s.selectedEvalID())
	return index >= 0 && next >= 0 && next < len(history)
}

func (s *Evals) activateLabel() string {
	if s.focus == evalsFocusCatalog {
		return "focus grid"
	}
	return "open observed run"
}

func (s *Evals) activateDisabledReason() string {
	if s.focus == evalsFocusCatalog {
		return disabledUnless(s.run.RunID != "", "no Eval run")
	}
	runID := s.selectedObservedRunID()
	if runID == "" {
		return "cell has no observed run"
	}
	snapshot := s.localRunResource.Snapshot()
	if snapshot.Token.Owner != evalLocalRunOwner(runID) ||
		!snapshot.HasValue || snapshot.Refreshing {
		return "checking local run"
	}
	if snapshot.Err != nil {
		return "availability check failed"
	}
	if !snapshot.Value.Checked || !snapshot.Value.Available {
		return "run not recorded locally"
	}
	return ""
}
